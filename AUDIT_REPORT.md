# Settle Alt — Informe de Auditoría

**Fecha:** 2026-02-10
**Alcance:** Código fuente completo, esquema de BD, políticas RLS, server actions, componentes, middleware, configuración
**Revisiones:** Pasada 1 (hallazgos #1-#19) + Pasada 2 (hallazgos #20-#36)

## Resumen Ejecutivo

Settle Alt es una aplicación funcional y bien estructurada para su alcance actual, con buenas prácticas en áreas como la separación de server actions, la validación de splits numéricos y el uso de RLS en todas las tablas. Sin embargo, la auditoría ha identificado **3 vulnerabilidades de seguridad críticas en las políticas RLS** que permiten a cualquier usuario autenticado ver los datos de todos los grupos, leer miembros placeholder de cualquier grupo y potencialmente vincular su cuenta a placeholders ajenos. Estas vulnerabilidades son consecuencia directa de parches sucesivos en las migraciones 002/004/005 que ampliaron excesivamente los permisos para resolver el flujo de invitación.

La segunda pasada de auditoría ha revelado **2 hallazgos críticos adicionales**: una race condition en la vinculación de placeholders que podría permitir a un usuario usurpar la identidad de otro dentro de un grupo, y la ausencia total de headers de seguridad HTTP. También se han identificado problemas significativos en integridad referencial (foreign keys sin cascada que bloquearían la eliminación de usuarios), ausencia total de rate limiting, cero tests, cero logging/error tracking, y problemas de accesibilidad.

En el frente de rendimiento, la aplicación es razonable para grupos pequeños pero tiene un patrón de client-side waterfall (datos cargados en `useEffect` en vez de server-side) que añade latencia innecesaria y recarga datos completos tras cada operación. El algoritmo de balances es correcto y eficiente (O(E+S+M log M)), con buen manejo de redondeo. La cobertura de índices es adecuada para las queries actuales, con espacio para optimización menor con índices compuestos.

---

## Hallazgos Críticos 🔴

### 1. Política RLS de grupos permite a cualquier usuario autenticado leer TODOS los grupos

- **Archivo(s):** `supabase/migrations/001_initial_schema.sql` (línea ~133)
- **Problema:** La política `"Anyone authenticated can view group by invite code"` usa `USING (auth.uid() IS NOT NULL)`, lo que permite a cualquier usuario autenticado hacer SELECT sobre **cualquier grupo** de la base de datos. Como PostgreSQL evalúa políticas con lógica OR, esta política anula completamente la restricción de `"Members can view their groups"`.
- **Riesgo:** Cualquier usuario autenticado puede enumerar todos los grupos existentes, ver sus nombres, descripciones, estados y **invite_codes**. Con el invite_code, pueden unirse a cualquier grupo sin necesidad de recibir una invitación legítima.
- **Solución propuesta:** Eliminar la política permisiva y restringir la lectura por invite_code usando una función RPC que valide solo lo necesario para el flujo de invitación:

```sql
-- Eliminar la política permisiva
DROP POLICY "Anyone authenticated can view group by invite code" ON groups;

-- Crear una función RPC para el join flow que devuelva solo campos públicos
CREATE OR REPLACE FUNCTION get_group_preview_by_invite(code TEXT)
RETURNS TABLE(id UUID, name TEXT, description TEXT, emoji TEXT, status group_status) AS $$
  SELECT id, name, description, emoji, status
  FROM groups
  WHERE invite_code = code;
$$ LANGUAGE sql SECURITY DEFINER STABLE;
```

Alternativamente, si se quiere mantener la política RLS, restringirla:
```sql
-- Solo permite leer si el usuario tiene el invite_code exacto
-- (requiere pasar el código como parámetro en la query)
CREATE POLICY "Authenticated users can view group by invite code"
  ON groups FOR SELECT
  USING (auth.uid() IS NOT NULL AND invite_code = current_setting('app.invite_code', true));
```

### 2. Política RLS de members permite modificar placeholders de CUALQUIER grupo

- **Archivo(s):** `supabase/migrations/005_fix_update_policy_with_check.sql` (línea ~9)
- **Problema:** La cláusula USING del UPDATE policy incluye `(user_id IS NULL AND auth.uid() IS NOT NULL)`, lo que permite a cualquier usuario autenticado actualizar **cualquier fila** de la tabla `members` donde `user_id IS NULL`, sin importar el grupo. Combinado con el hallazgo #1 (visibilidad total de grupos) y #3 (visibilidad de placeholders), un atacante puede:
  1. Ver todos los grupos y sus placeholders
  2. Vincular su cuenta a un placeholder de un grupo ajeno
  3. Obtener acceso completo a los gastos, balances y datos de ese grupo
- **Riesgo:** Escalación de privilegios. Un usuario puede infiltrarse en cualquier grupo vinculándose a un placeholder no reclamado.
- **Solución propuesta:** La política UPDATE debe ser más restrictiva. El flujo de join ya usa `createAdminClient()` para bypass de RLS, así que la política solo necesita cubrir el caso de miembros existentes:

```sql
DROP POLICY "Members can update group members" ON members;

CREATE POLICY "Members can update group members"
  ON members FOR UPDATE
  USING (is_group_member(group_id))
  WITH CHECK (is_group_member(group_id));
```

Dado que `joinGroup` ya usa admin client para la vinculación de placeholders, esta política más restrictiva no rompe nada.

### 3. Política RLS expone todos los miembros placeholder a cualquier usuario autenticado

- **Archivo(s):** `supabase/migrations/004_allow_view_placeholders.sql` (línea ~7)
- **Problema:** La política `"Authenticated users can view placeholder members"` permite a cualquier usuario autenticado ver **todos** los miembros placeholder de **todos** los grupos. La condición es solo `user_id IS NULL AND auth.uid() IS NOT NULL`.
- **Riesgo:** Fuga de información. Cualquier usuario puede ver los nombres de personas que aún no se han registrado en grupos a los que no pertenece. Combinado con #1, permite mapear la estructura completa de cualquier grupo.
- **Solución propuesta:** Eliminar esta política. El flujo de join (`join/[code]/page.tsx`) ya carga los miembros usando `getGroupMembers()`, que funciona porque el server component tiene acceso legítimo. Si se necesita que el usuario no-miembro vea los placeholders, hacerlo via RPC:

```sql
DROP POLICY "Authenticated users can view placeholder members" ON members;

-- Opción: RPC que devuelve placeholders de un grupo por invite_code
CREATE OR REPLACE FUNCTION get_group_placeholders(code TEXT)
RETURNS TABLE(id UUID, display_name TEXT) AS $$
  SELECT m.id, m.display_name
  FROM members m
  JOIN groups g ON g.id = m.group_id
  WHERE g.invite_code = code
    AND m.user_id IS NULL
    AND auth.uid() IS NOT NULL;
$$ LANGUAGE sql SECURITY DEFINER STABLE;
```

### 20. Race condition en la vinculación de placeholders

- **Archivo(s):** `src/lib/actions/members.ts` (líneas 101-129)
- **Problema:** Cuando dos usuarios intentan vincular su cuenta al **mismo** placeholder simultáneamente, hay una race condition clásica TOCTOU (time-of-check-time-of-use):
  1. Usuario A consulta el placeholder → `user_id IS NULL` ✓
  2. Usuario B consulta el mismo placeholder → `user_id IS NULL` ✓
  3. Usuario A ejecuta `UPDATE ... SET user_id = A.id WHERE id = memberId` → OK
  4. Usuario B ejecuta `UPDATE ... SET user_id = B.id WHERE id = memberId` → **sobrescribe** a A

  El resultado: Usuario A pierde su vinculación sin saberlo, y Usuario B roba la identidad del placeholder (y hereda todos sus gastos y deudas). El uso de `createAdminClient()` (que bypassa RLS) agrava el problema porque no hay constraint que lo impida a nivel de BD — la condición `WHERE user_id IS NULL` no está en la cláusula UPDATE del admin client.
- **Riesgo:** Usurpación de identidad dentro de un grupo. El Usuario A podría acabar siendo responsable de deudas que no le corresponden, o perder acceso al grupo sin explicación.
- **Solución propuesta:** Añadir `WHERE user_id IS NULL` a la cláusula UPDATE del admin client y verificar que se afectó exactamente 1 fila:

```typescript
const { data, error: updateError, count } = await adminSupabase
  .from("members")
  .update({ user_id: user.id })
  .eq("id", memberId)
  .is("user_id", null)  // ← Atómica: solo actualiza si sigue siendo NULL
  .select();

if (updateError) {
  return { error: `Error al vincular: ${updateError.message}` };
}
if (!data || data.length === 0) {
  return { error: "Este miembro ya fue vinculado por otra persona" };
}
```

### 21. Sin headers de seguridad HTTP configurados

- **Archivo(s):** `next.config.ts` (líneas 1-7), `src/lib/supabase/middleware.ts`
- **Problema:** `next.config.ts` está completamente vacío (sin configuración alguna) y el middleware no añade ningún header de seguridad. Faltan todos los headers estándar:
  - `X-Content-Type-Options: nosniff` — previene MIME type sniffing
  - `X-Frame-Options: DENY` — previene clickjacking
  - `Strict-Transport-Security` (HSTS) — fuerza HTTPS
  - `Referrer-Policy: strict-origin-when-cross-origin` — controla qué info de referrer se envía
  - `Content-Security-Policy` — previene XSS y data injection
  - `Permissions-Policy` — restringe APIs del navegador

  Vercel añade algunos headers por defecto (`X-Frame-Options: SAMEORIGIN`), pero no es suficiente y no cubre despliegues fuera de Vercel.
- **Riesgo:** La app es vulnerable a clickjacking (embeber en iframe malicioso), MIME confusion attacks, y no aprovecha protecciones modernas del navegador. Una CSP básica previene muchos vectores de XSS.
- **Solución propuesta:** Configurar headers en `next.config.ts`:

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          {
            key: "Content-Security-Policy",
            value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.googleusercontent.com; connect-src 'self' https://*.supabase.co wss://*.supabase.co; frame-ancestors 'none';",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
```

---

## Hallazgos Importantes 🟡

### 4. Sin validación de longitudes ni rangos máximos en el servidor para gastos

- **Archivo(s):** `src/lib/actions/expenses.ts` (líneas ~130-135)
- **Problema:** `createExpense` y `updateExpense` validan que `amount > 0` y `description.trim()` no esté vacío, pero no validan:
  - Longitud máxima de descripción (solo `maxLength={200}` en el cliente, no en el servidor)
  - Valor máximo de amount (el CHECK de la BD es `amount > 0` sin límite superior; el tipo `DECIMAL(10,2)` permite hasta 99,999,999.99)
  - Valores negativos o NaN en `splitValues` del cliente (se pasan como `Record<string, number>`)
- **Riesgo:** Un usuario malicioso puede enviar descripciones enormes o montos absurdos directamente llamando a la server action sin pasar por la UI.
- **Solución propuesta:** Añadir validación de Zod o manual en el servidor:

```typescript
if (data.description.trim().length > 200) return { error: "Descripción demasiado larga" };
if (data.amount > 999999.99) return { error: "Importe demasiado alto" };
if (!Number.isFinite(data.amount)) return { error: "Importe no válido" };
```

### 5. Patrón de error inconsistente entre server actions

- **Archivo(s):** `src/lib/actions/groups.ts`, `src/lib/actions/members.ts`, `src/lib/actions/expenses.ts`
- **Problema:** Algunas acciones lanzan excepciones (`getMyGroups` → `throw new Error`), mientras que otras devuelven objetos de error (`createGroup` → `{ error: string }`). Esto dificulta el manejo en el cliente:
  - `getMyGroups` (línea 13): `throw new Error("No autenticado")`
  - `getGroupMembers` (línea 16): `throw new Error(error.message)`
  - `createGroup` (línea 57): `return { error: "No autenticado" }`
  - `createExpense` (línea 145): `return { error: "No autenticado" }`
- **Riesgo:** Las acciones que lanzan excepciones pueden causar errores no manejados en componentes que no usan try/catch (ej: `getMyGroups` se llama en `page.tsx` sin try/catch).
- **Solución propuesta:** Unificar a un patrón consistente. Para server actions llamadas desde componentes cliente, usar `{ data, error }`. Para funciones de data-fetching llamadas desde server components, throw es aceptable si el page tiene error boundary.

### 6. Client-side data waterfall en las tabs de grupo

- **Archivo(s):** `src/components/group-expenses-tab.tsx` (línea 40-53), `src/components/group-balances-tab.tsx` (línea 57-70), `src/components/group-settings-tab.tsx` (línea 65-67)
- **Problema:** Las tres tabs cargan datos con `useEffect` en el cliente después del render. Esto crea un waterfall:
  1. Servidor renderiza la página con datos básicos del grupo (RTT 1)
  2. Página llega al cliente y React hidrata
  3. Las tres tabs disparan `useEffect` simultáneamente → 3 server actions paralelas (RTT 2)
  4. El usuario ve spinners ~200-500ms adicionales

  Además, las tres tabs cargan datos en paralelo aunque solo una sea visible, lo cual desperdicia ancho de banda y procesamiento.
- **Riesgo:** Latencia percibida innecesaria. En redes lentas (3G móvil), este doble round-trip se nota mucho.
- **Solución propuesta:** Cargar los datos en el server component (`groups/[groupId]/page.tsx`) y pasarlos como props:

```typescript
// En page.tsx, cargar datos de la tab activa server-side
const [group, members, currentMember, expenses] = await Promise.all([
  getGroup(groupId),
  getGroupMembers(groupId),
  getCurrentMember(groupId),
  getGroupExpenses(groupId),
]);
```

O usar el patrón de `Suspense` con server components parciales para cada tab.

### 7. Recarga completa de datos tras cada operación

- **Archivo(s):** `src/components/group-expenses-tab.tsx` (líneas 65-81)
- **Problema:** Después de crear, editar o eliminar un gasto, se llama `loadExpenses()` que recarga TODOS los gastos del grupo desde cero. Lo mismo ocurre en `group-balances-tab.tsx` (línea 88). No hay optimistic UI.
- **Riesgo:** UX más lenta de lo necesario. En un grupo con muchos gastos, recargar todo es ineficiente.
- **Solución propuesta:** Opción 1: Usar `router.refresh()` (que ya se llama en algunos sitios) + server-side data loading. Opción 2: Implementar actualización optimista del state local antes de confirmar con el servidor.

### 8. `getMyGroups` ejecuta consultas separadas que podrían ser una sola

- **Archivo(s):** `src/lib/actions/groups.ts` (líneas 8-46)
- **Problema:** La función hace 3 consultas separadas:
  1. `members.select("group_id").eq("user_id", user.id)` — obtener IDs de grupo
  2. `groups.select("*").in("id", groupIds)` — obtener grupos
  3. `members.select("group_id").in("group_id", groupIds)` — contar miembros

  La tercera consulta carga TODOS los miembros de todos los grupos del usuario solo para contar.
- **Riesgo:** Con muchos grupos y miembros, esto es ineficiente.
- **Solución propuesta:** Usar una vista o RPC en Supabase:

```sql
CREATE OR REPLACE FUNCTION get_my_groups()
RETURNS TABLE(
  id UUID, name TEXT, description TEXT, emoji TEXT,
  status group_status, created_at TIMESTAMPTZ,
  invite_code TEXT, created_by UUID,
  frozen_at TIMESTAMPTZ, archived_at TIMESTAMPTZ,
  member_count BIGINT
) AS $$
  SELECT g.*, COUNT(m2.id) as member_count
  FROM groups g
  JOIN members m ON m.group_id = g.id AND m.user_id = auth.uid()
  JOIN members m2 ON m2.group_id = g.id
  GROUP BY g.id
  ORDER BY g.created_at DESC;
$$ LANGUAGE sql SECURITY DEFINER STABLE;
```

### 9. Falta transacción atómica al crear gastos con splits

- **Archivo(s):** `src/lib/actions/expenses.ts` (líneas ~192-221)
- **Problema:** `createExpense` primero inserta el gasto y luego inserta los splits. Si la inserción de splits falla, intenta limpiar eliminando el gasto (`await supabase.from("expenses").delete().eq("id", expense.id)`). Pero este cleanup puede fallar silenciosamente, dejando gastos huérfanos sin splits. Además, en `updateExpense`, el borrado de splits antiguos y la inserción de nuevos no son atómicos — un fallo entre el DELETE y el INSERT dejaría un gasto sin splits.
- **Riesgo:** Datos inconsistentes si hay un fallo entre operaciones (p.ej. timeout de red).
- **Solución propuesta:** Usar una función RPC de Supabase con una transacción real:

```sql
CREATE OR REPLACE FUNCTION create_expense_with_splits(
  p_group_id UUID, p_paid_by UUID, p_description TEXT,
  p_amount DECIMAL, p_split_type split_type, p_created_by UUID,
  p_splits JSONB
) RETURNS UUID AS $$
DECLARE
  v_expense_id UUID;
BEGIN
  INSERT INTO expenses (group_id, paid_by, description, amount, split_type, created_by)
  VALUES (p_group_id, p_paid_by, p_description, p_amount, p_split_type, p_created_by)
  RETURNING id INTO v_expense_id;

  INSERT INTO expense_splits (expense_id, member_id, amount)
  SELECT v_expense_id, (s->>'memberId')::UUID, (s->>'amount')::DECIMAL
  FROM jsonb_array_elements(p_splits) s;

  RETURN v_expense_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### 10. Cualquier miembro puede editar/eliminar gastos de otros y saldar transferencias ajenas

- **Archivo(s):** `src/lib/actions/expenses.ts` (línea ~277), `src/lib/actions/settlements.ts` (línea ~190)
- **Problema:** No hay verificación de que el usuario que edita/elimina un gasto sea el creador o el pagador. Tampoco se verifica que quien marca una transferencia como saldada sea parte de esa transferencia. Solo se verifica pertenencia al grupo (vía RLS).
- **Riesgo:** Un miembro del grupo puede alterar gastos de otros o marcar como saldadas transferencias en las que no participa.
- **Solución propuesta:** Para gastos, añadir verificación en la server action:
```typescript
// Solo el creador puede editar/eliminar
if (expense.created_by !== currentMember.id) {
  return { error: "Solo el creador puede modificar este gasto" };
}
```
Para settlements, verificar que el usuario es parte de la transferencia o implementar un flujo de confirmación mutua.

### 22. Foreign keys sin ON DELETE CASCADE bloquean la eliminación de usuarios

- **Archivo(s):** `supabase/migrations/001_initial_schema.sql` (líneas 24, 35, 55-56, 71, 83-84)
- **Problema:** Varias foreign keys del esquema NO tienen `ON DELETE CASCADE`, lo que causa problemas en cadena:

  | FK | Tiene CASCADE? | Consecuencia |
  |---|---|---|
  | `groups.created_by → users(id)` | **NO** | Si un usuario elimina su cuenta, la FK bloquea el borrado |
  | `members.user_id → users(id)` | **NO** | Mismo problema — un usuario con membresías no puede eliminarse |
  | `expenses.paid_by → members(id)` | **NO** | Un member no puede borrarse si tiene gastos |
  | `expenses.created_by → members(id)` | **NO** | Mismo problema |
  | `expense_splits.member_id → members(id)` | **NO** | Un member no puede borrarse si tiene splits |
  | `settlements.from_member → members(id)` | **NO** | Un member no puede borrarse si tiene settlements |
  | `settlements.to_member → members(id)` | **NO** | Mismo problema |

  Las FKs que SÍ tienen CASCADE (y están correctas):
  - `users.id → auth.users(id)` ON DELETE CASCADE ✓
  - `members.group_id → groups(id)` ON DELETE CASCADE ✓
  - `groups → expenses, settlements` ON DELETE CASCADE ✓
  - `expenses → expense_splits` ON DELETE CASCADE ✓

  **Nota:** La eliminación de un GRUPO completo funciona correctamente porque expenses, members y settlements todos tienen CASCADE desde groups. PostgreSQL procesa las cascadas en la misma transacción, así que las FKs de members hacia expenses/settlements se resuelven antes de que se validen.

- **Riesgo:** Si en el futuro se implementa "eliminar cuenta" o "salir del grupo", las FKs bloquearán la operación con un error de constraint violation. Actualmente el usuario no puede eliminar su cuenta de Google desde la app, pero Supabase sí permite eliminar usuarios desde el dashboard — lo cual fallaría.
- **Solución propuesta:** Dos opciones según la semántica deseada:

  **Opción A — SET NULL (recomendada para members.user_id):**
  ```sql
  -- Si un usuario se va, desvincular su member pero mantener el historial
  ALTER TABLE members DROP CONSTRAINT members_user_id_fkey;
  ALTER TABLE members ADD CONSTRAINT members_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

  -- Si el creador de un grupo se va, mantener el grupo
  ALTER TABLE groups DROP CONSTRAINT groups_created_by_fkey;
  ALTER TABLE groups ADD CONSTRAINT groups_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
  -- (requiere ALTER TABLE groups ALTER COLUMN created_by DROP NOT NULL)
  ```

  **Opción B — Soft delete (no eliminar nunca filas de users):**
  Añadir `deleted_at TIMESTAMPTZ` a users y filtrar por `deleted_at IS NULL`. Más seguro para integridad de datos.

### 23. Sin rate limiting en ninguna server action ni endpoint

- **Archivo(s):** Todas las server actions en `src/lib/actions/`, `src/lib/supabase/middleware.ts`
- **Problema:** No existe ningún mecanismo de rate limiting en la aplicación. Un usuario (o bot) puede ejecutar sin límite:
  - Creación de grupos (`createGroup`) — spam ilimitado
  - Creación de gastos (`createExpense`) — llenar la BD
  - Creación de placeholder members (`addPlaceholderMember`) — spam de nombres
  - Intento de join con invite codes (`joinGroup`) — aunque con 48 bits de entropía (12 hex chars), fuerza bruta pura no es viable (~281 billones de combinaciones), un ataque dirigido con información parcial sí sería posible
  - Consultas de datos (`getGroupExpenses`, `getGroupBalances`) — posible DDoS a nivel de BD
- **Riesgo:** Abuso de recursos (BD llena, costes de Supabase elevados), spam, y potencial denegación de servicio para otros usuarios.
- **Solución propuesta:** Implementar rate limiting a nivel de middleware para las rutas que ejecutan server actions. Opciones:

  **Opción 1 — Middleware de Next.js con rate limiting en memoria (simple, para empezar):**
  ```typescript
  // En middleware.ts, usar un Map en memoria con ventana deslizante
  // Limitado: no funciona con múltiples instancias de servidor
  ```

  **Opción 2 — Upstash Rate Limit (recomendada para producción con Vercel):**
  ```bash
  npm install @upstash/ratelimit @upstash/redis
  ```
  ```typescript
  import { Ratelimit } from "@upstash/ratelimit";
  import { Redis } from "@upstash/redis";

  const ratelimit = new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow(20, "60 s"), // 20 requests por minuto
  });
  ```

  **Opción 3 — Rate limiting de Supabase:** Configurar rate limits en el dashboard de Supabase a nivel de API.

### 24. No hay tests — cero cobertura

- **Archivo(s):** Ninguno (no existen archivos de test en `src/`)
- **Problema:** El proyecto no tiene ningún test unitario, de integración o e2e. No hay framework de testing configurado (ni jest, ni vitest, ni playwright). Las funciones más críticas que se beneficiarían de tests son:
  1. `calculateSplits` — función pura con 4 ramas de lógica y aritmética de redondeo
  2. `calculateOptimizedTransfers` — algoritmo greedy con edge cases de redondeo
  3. `getGroupBalances` — cálculo de balances con settlements ajustados
  4. `joinGroup` — flujo complejo con múltiples ramas (nuevo, existente, placeholder)
  5. Flujo completo de crear gasto → verificar splits → calcular balances
- **Riesgo:** Refactorizaciones o nuevas features pueden romper lógica existente sin detectarse. Los cálculos de dinero son especialmente sensibles a regresiones.
- **Solución propuesta:** Empezar con vitest (más rápido que jest para proyectos Vite/Next.js):
  ```bash
  npm install -D vitest @testing-library/react
  ```
  Priorizar tests para:
  1. `calculateSplits` — todos los split types, edge cases de redondeo, 100/3, amounts muy pequeños
  2. `calculateOptimizedTransfers` — 2 personas, 5 personas, balances ya cuadrados, un solo deudor
  3. Validación de server actions — inputs malformados, auth missing

### 25. Sin logging ni error tracking en producción

- **Archivo(s):** Todas las server actions
- **Problema:** Los errores de Supabase se manejan de tres formas, ninguna con logging:
  - Se lanzan como excepciones (sin captura superior): `getMyGroups`, `getGroupMembers`
  - Se devuelven como `{ error: string }` al cliente (el error original de Supabase se pierde)
  - Se tragan silenciosamente devolviendo arrays vacíos: `getGroupExpenses` (línea 238), `getGroupSettlements` (línea 254), `getGroupBalances` (línea 41)

  El único `console.error` en toda la app está en `auth/callback/route.ts` (línea 14). No hay Sentry, LogRocket, ni ningún servicio de error tracking.
- **Riesgo:** Si un usuario reporta un problema en producción, no hay forma de diagnosticarlo. Los errores silenciosos (como fallos de RLS que devuelven arrays vacíos) son especialmente difíciles de detectar.
- **Solución propuesta:**
  1. Añadir Sentry (tiene integración nativa con Next.js y Vercel):
     ```bash
     npx @sentry/wizard@latest -i nextjs
     ```
  2. Como mínimo, añadir `console.error` con contexto en cada catch:
     ```typescript
     if (error) {
       console.error("[getGroupExpenses]", { groupId, error: error.message, code: error.code });
       return [];
     }
     ```

### 26. `userScalable: false` en viewport bloquea zoom de accesibilidad

- **Archivo(s):** `src/app/layout.tsx` (línea 28)
- **Problema:** La configuración del viewport incluye `userScalable: false` y `maximumScale: 1`, lo que impide a los usuarios hacer pinch-to-zoom en móvil. Esto es una violación de WCAG 2.1 criterio 1.4.4 (Resize Text) y puede impedir el uso de la app a personas con baja visión.
- **Riesgo:** Problemas de accesibilidad y posible incumplimiento de regulaciones de accesibilidad (especialmente relevante en la UE con el European Accessibility Act que entra en vigor en 2025).
- **Solución propuesta:** Eliminar las restricciones de zoom:
```typescript
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#ffffff",
  // Eliminar: maximumScale, userScalable
};
```

### 27. `SUPABASE_SERVICE_ROLE_KEY` no documentada en `.env.local.example`

- **Archivo(s):** `.env.local.example` (líneas 1-2)
- **Problema:** El archivo solo documenta `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`, pero el proyecto necesita `SUPABASE_SERVICE_ROLE_KEY` para que el flujo de join con placeholders funcione (usado en `createAdminClient`). Un desarrollador nuevo que clone el repo no sabrá que necesita esta variable.
- **Riesgo:** El flujo de join fallará en desarrollo sin aviso claro del motivo. En producción, si la variable no está en Vercel, `createAdminClient()` fallará con un error críptico de Supabase.
- **Solución propuesta:** Actualizar `.env.local.example`:
```
NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

### 28. Balances se recalculan desde cero en cada visita sin caching

- **Archivo(s):** `src/lib/actions/settlements.ts` (líneas 34-128)
- **Problema:** `getGroupBalances` carga TODOS los expenses, TODOS los splits y TODOS los settlements del grupo cada vez que se abre la tab de balances. No hay caching a ningún nivel:
  - No hay `unstable_cache` de Next.js
  - No hay memoización de resultados
  - No hay vista materializada en Supabase
  - La función se llama desde un `useEffect` en el cliente, por lo que tampoco se beneficia del caching de `fetch` de Next.js

  Para un grupo con 500 gastos y 10 miembros: ~500 expenses + ~2500 splits + N settlements = ~3000+ filas procesadas cada vez.
- **Riesgo:** Latencia creciente y coste de BD a medida que el grupo acumula más gastos. Acceptable para grupos pequeños (< 100 gastos), pero puede degradarse para viajes largos.
- **Solución propuesta:** Mover a una RPC que calcule todo en el lado de la BD (evita transferir filas al servidor de Next.js), o implementar una vista materializada que se actualice al crear/editar/eliminar gastos.

---

## Mejoras Recomendadas 🟢

### 11. Código duplicado: constantes compartidas

- **Archivo(s):** `src/components/expense-form-sheet.tsx` (línea 34), `src/components/expense-detail-sheet.tsx` (línea 33), `src/components/group-card.tsx` (línea 7), `src/components/group-detail.tsx` (línea 12)
- **Problema:** `SPLIT_TYPE_LABELS` está definido en dos componentes. `STATUS_CONFIG` está definido en dos componentes.
- **Solución propuesta:** Mover a archivos compartidos:
```
src/lib/constants.ts → SPLIT_TYPE_LABELS, STATUS_CONFIG
```

### 12. Función `getInitials` duplicada

- **Archivo(s):** `src/components/app-header.tsx` (línea 15), `src/lib/utils/format.ts` (línea 28)
- **Problema:** `app-header.tsx` define su propia versión de `getInitials` que maneja `null | undefined`, mientras que la de `format.ts` no lo hace.
- **Solución propuesta:** Mejorar la versión en `format.ts` para manejar null/undefined y eliminar la duplicada en `app-header.tsx`.

### 13. Tipos y dependencias no utilizados

- **Archivo(s):** `src/lib/types/index.ts` (línea 62), `package.json`
- **Problema:**
  - `MemberWithUser` interface está definida pero nunca importada en ningún componente.
  - `next-themes` está en dependencies pero no se usa (no hay toggle de dark mode).
  - Variables CSS de sidebar (`--sidebar-*`) en `globals.css` pero no hay sidebar.
  - `--font-geist-mono` en globals.css pero Geist Mono no está importado.
- **Solución propuesta:** Eliminar el tipo no usado, desinstalar `next-themes` si no se planea dark mode a corto plazo, y limpiar las variables CSS innecesarias.

### 14. `createAdminClient` usa `require()` en módulo ESM

- **Archivo(s):** `src/lib/supabase/server.ts` (línea 33)
- **Problema:** La función `createAdminClient` usa `require("@supabase/supabase-js")` dentro de una función en un módulo que usa ES imports. Esto se hizo para evitar importar el admin client en el bundle del cliente, pero es un code smell que puede causar problemas en futuras versiones de Next.js.
- **Solución propuesta:** Usar dynamic import con `await import()`:
```typescript
export async function createAdminClient() {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
```
Y actualizar `joinGroup` para `await createAdminClient()`.

### 15. Historial de liquidaciones duplicado en dos componentes

- **Archivo(s):** `src/components/group-balances-tab.tsx` (líneas 232-275), `src/components/group-settings-tab.tsx` (líneas 210-253)
- **Problema:** El bloque de "Historial de liquidaciones" (markup, lógica de lookup de miembros, formatting) está duplicado casi idénticamente en las tabs de balances y settings. Además, settings carga los settlements por separado con `getGroupSettlements` cuando ya están disponibles en la respuesta de `getGroupBalances`.
- **Solución propuesta:** Extraer un componente `<SettlementHistory settlements={...} members={...} />` compartido. Considerar si realmente necesita estar en ambas tabs o si una sola ubicación es suficiente.

### 16. No hay loading skeletons, solo spinners

- **Archivo(s):** `src/components/group-expenses-tab.tsx` (línea 83-89), `src/components/group-balances-tab.tsx` (línea 95-101)
- **Problema:** Los estados de carga muestran un spinner genérico. No hay skeleton screens que den contexto sobre qué contenido va a aparecer.
- **Solución propuesta:** Implementar skeletons que imiten la forma del contenido final (lista de gastos, tabla de balances) para reducir el perceived layout shift.

### 17. Validación del parámetro `next` en auth callback

- **Archivo(s):** `src/app/auth/callback/route.ts` (línea 7)
- **Problema:** El parámetro `next` se usa directamente en la redirección sin validar que sea una ruta relativa interna. Aunque `${origin}${next}` mitiga open redirect en la mayoría de casos, es una buena práctica validar explícitamente.
- **Solución propuesta:**
```typescript
const next = searchParams.get("next") ?? "/";
// Validate: must start with "/" and not "//"
const safePath = next.startsWith("/") && !next.startsWith("//") ? next : "/";
return NextResponse.redirect(`${origin}${safePath}`);
```

### 18. PWA: Service worker básico sin caching real

- **Archivo(s):** `src/components/sw-register.tsx` (línea 8), `public/sw.js`
- **Problema:** El service worker existe pero es puramente cosmético — solo habilita la instalabilidad PWA. Su fetch handler (`fetch(event.request).catch(() => caches.match(event.request))`) intenta servir desde cache en caso de error de red, pero **nunca escribe nada en cache**, por lo que `caches.match` siempre devolverá `undefined`. El resultado: no hay soporte offline real.
- **Solución propuesta:** O implementar caching real con Workbox/Serwist para la shell de la app, o simplificar el SW a lo mínimo para install prompt y documentar la limitación.

### 19. Tabs montan todas las tabs simultáneamente

- **Archivo(s):** `src/components/group-detail.tsx` (líneas 70-84)
- **Problema:** Las tres `TabsContent` se renderizan siempre (aunque solo una sea visible). Esto monta los tres componentes hijos, que a su vez disparan tres `useEffect` de carga de datos en paralelo.
- **Solución propuesta:** Usar el prop `forceMount` condicionalmente o controlar el montaje con un estado:
```tsx
<TabsContent value="expenses" className="...">
  <GroupExpensesTab ... />
</TabsContent>
```
Shadcn/Radix `TabsContent` desmonta por defecto el contenido cuando no está activo. Verificar que esto funcione correctamente, y si no, usar renderizado condicional manual.

### 29. Índices compuestos que mejorarían queries frecuentes

- **Archivo(s):** `supabase/migrations/001_initial_schema.sql`
- **Problema:** Los índices actuales cubren bien las columnas individuales, pero las queries más frecuentes usan combinaciones de columnas que se beneficiarían de índices compuestos:

  **Índices existentes (8 total):**
  1. `members_group_user_unique` — UNIQUE `(group_id, user_id) WHERE user_id IS NOT NULL`
  2. `members_user_id_idx` — `(user_id) WHERE user_id IS NOT NULL`
  3. `members_group_id_idx` — `(group_id)`
  4. `expenses_group_id_idx` — `(group_id)`
  5. `expense_splits_expense_id_idx` — `(expense_id)`
  6. `expense_splits_member_id_idx` — `(member_id)`
  7. `settlements_group_id_idx` — `(group_id)`
  8. UNIQUE en `groups.invite_code` (implícito)

  **Índices compuestos recomendados:**
  - `expenses (group_id, created_at DESC)` — usado en `getGroupExpenses` que siempre filtra por group_id y ordena por created_at. Actualmente usa el índice de group_id y luego ordena en memoria.
  - `settlements (group_id, created_at DESC)` — mismo patrón en `getGroupSettlements`.

  **Índice que sobra potencialmente:**
  - `members_group_id_idx` es redundante con `members_group_user_unique` para queries que filtran por `(group_id, user_id)`, pero sigue útil para queries que solo filtran por `group_id` (sin user_id). **Mantener.**

- **Riesgo:** Impacto menor. Las queries actuales funcionan, pero con grupos grandes (100+ gastos) la diferencia entre un index scan vs. sort se notará.
- **Solución propuesta:**
```sql
CREATE INDEX expenses_group_created_idx ON expenses (group_id, created_at DESC);
CREATE INDEX settlements_group_created_idx ON settlements (group_id, created_at DESC);
```

### 30. Esquema de BD necesita preparación para features futuras

- **Archivo(s):** `supabase/migrations/001_initial_schema.sql`
- **Problema:** El esquema actual no contempla varias features que probablemente se necesitarán:

  | Feature | Estado actual | Cambio necesario |
  |---|---|---|
  | **Múltiples monedas** | No hay columna currency | Añadir `currency TEXT DEFAULT 'EUR'` a groups o expenses |
  | **Categorías de gastos** | No existe | Añadir `category TEXT` a expenses (o tabla categories) |
  | **Fotos de recibos** | `image_url TEXT` ya existe en expenses | Solo falta la UI y el upload a Supabase Storage |
  | **Gastos recurrentes** | No existe | Requeriría tabla `recurring_expenses` o campos `recurrence_*` |
  | **Audit log** | Solo `updated_at` en expenses | Requeriría tabla `activity_log` o trigger de historial |
  | **Notificaciones** | No existe | Requeriría tabla `notifications` + sistema push/in-app |
  | **Enums** | `group_status` y `split_type` son PostgreSQL ENUMs | Extensibles con `ALTER TYPE ... ADD VALUE` (no requiere reestructuración) |

- **Riesgo:** No es un problema actual, pero si se añaden monedas o categorías más adelante, requeriría migración de datos existentes.
- **Solución propuesta:** Si múltiples monedas están en el roadmap, añadir la columna ahora con default `'EUR'` para evitar migración futura. Lo mismo para categorías si está planificado.

### 31. Estructura plana de componentes no escala

- **Archivo(s):** `src/components/` (12 archivos en una sola carpeta)
- **Problema:** Todos los componentes custom están en `src/components/` sin subcarpetas. Con 12 archivos es manejable, pero si el proyecto crece a 30+ componentes (que es probable con features como notificaciones, perfil, multi-moneda, etc.), la carpeta se volverá difícil de navegar. Además, la lógica de negocio (cálculo de splits, optimización de transferencias) vive dentro de los archivos de server actions en vez de estar en su propia capa.
- **Solución propuesta:** Reorganizar cuando se superen ~20 componentes:
```
src/
  components/
    ui/          ← shadcn (ya existe)
    groups/      ← group-card, group-detail, group-settings-tab, etc.
    expenses/    ← expense-form-sheet, expense-detail-sheet, expense-card
    balances/    ← group-balances-tab, transfer-card, settlement-history
    layout/      ← app-header, emoji-picker
  lib/
    actions/     ← server actions (ya existe)
    services/    ← calculateSplits, calculateOptimizedTransfers (extraer de actions)
    validators/  ← validación con Zod (futuro)
```

### 32. Botones con solo iconos sin aria-label

- **Archivo(s):** `src/components/group-detail.tsx` (línea 36-39), `src/components/group-settings-tab.tsx` (línea 179), `src/components/emoji-picker.tsx` (línea 23)
- **Problema:** Varios botones con solo iconos (sin texto visible) carecen de `aria-label`:
  - Botón de "volver" en group-detail: `<button><ArrowLeft /></button>` — sin aria-label
  - Botón de "añadir miembro" en settings: `<Button size="icon"><UserPlus /></Button>` — sin aria-label
  - Botón de emoji picker: `<button>{value || "😀"}</button>` — sin aria-label
- **Riesgo:** Los screen readers anunciarán estos botones como "button" sin contexto de su función. Esto viola WCAG 2.1 criterio 1.1.1 (Non-text Content).
- **Solución propuesta:** Añadir `aria-label` a cada botón:
```tsx
<button aria-label="Volver" onClick={() => router.push("/")}>
<Button size="icon" aria-label="Añadir miembro">
<button type="button" aria-label="Seleccionar emoji">
```

### 33. Columna `image_url` en expenses existe pero no se usa

- **Archivo(s):** `supabase/migrations/001_initial_schema.sql` (línea 59), `src/lib/types/index.ts` (línea 46)
- **Problema:** La tabla `expenses` tiene una columna `image_url TEXT` para fotos de recibos, y el tipo `Expense` incluye `image_url: string | null`. Pero ningún componente permite subir o visualizar imágenes de recibos. La columna ocupa espacio en el esquema sin aportar funcionalidad.
- **Solución propuesta:** Mantenerla si la feature de fotos de recibos está en el roadmap próximo. Si no, eliminarla para no confundir a futuros desarrolladores. Cuando se implemente, usar Supabase Storage para las imágenes.

### 34. `createGroup` no es atómico: grupo creado pero miembro no

- **Archivo(s):** `src/lib/actions/groups.ts` (líneas 72-99)
- **Problema:** Similar al hallazgo #9, `createGroup` inserta el grupo y luego inserta al creador como miembro. Si la segunda inserción falla (ej: error de RLS, timeout), queda un grupo sin miembros y el creador no tiene acceso al grupo que acaba de crear. No hay cleanup del grupo en caso de fallo.
- **Solución propuesta:** Incluir en la RPC transaccional del bloque 3 o hacer cleanup explícito:
```typescript
if (memberError) {
  await supabase.from("groups").delete().eq("id", group.id);
  return { error: memberError.message };
}
```

### 35. No hay protección contra doble submit a nivel de servidor

- **Archivo(s):** Todas las server actions de mutación
- **Problema:** Los formularios desactivan el botón de submit con `disabled={loading}` en el cliente, lo que previene doble-clicks accidentales. Sin embargo, un usuario técnico podría llamar directamente a las server actions dos veces en paralelo (ej: desde DevTools o un script). Esto crearía gastos duplicados, settlements duplicados, etc.
- **Riesgo:** Bajo para usuarios normales (el botón disabled funciona), pero posible para manipulación intencional.
- **Solución propuesta:** Para las operaciones más sensibles (crear gasto, marcar settlement), añadir un idempotency key o verificar duplicados recientes:
```typescript
// Ejemplo simple: no permitir dos gastos idénticos en 5 segundos
const { data: recentDuplicate } = await supabase
  .from("expenses")
  .select("id")
  .eq("group_id", data.groupId)
  .eq("amount", data.amount)
  .eq("description", data.description.trim())
  .gte("created_at", new Date(Date.now() - 5000).toISOString())
  .maybeSingle();

if (recentDuplicate) return { error: "Gasto duplicado detectado" };
```

### 36. Formularios de montos no previenen valores problemáticos en móvil

- **Archivo(s):** `src/components/expense-form-sheet.tsx` (líneas 338-353)
- **Problema:** El input de importe usa `type="number" inputMode="decimal"`, lo cual es correcto para abrir el teclado numérico en móvil. Sin embargo:
  - No hay `pattern` attribute para validar el formato en HTML
  - En iOS Safari, `type="number"` con locale español puede causar problemas con la coma vs punto decimal
  - No hay handler de `onBlur` para formatear/normalizar el valor (ej: "10,5" → "10.50")
  - Los inputs de split (exact, percentage, shares) tienen el mismo problema
- **Riesgo:** Menor. JavaScript `parseFloat` maneja puntos pero no comas, por lo que un usuario español que escriba "10,50" obtendrá `NaN` al parsear. Sin embargo, `type="number"` en la mayoría de navegadores normaliza la coma a punto antes de pasar el valor al DOM.
- **Solución propuesta:** Validar y manejar explícitamente ambos separadores si se detectan problemas en iOS:
```typescript
const normalizeAmount = (value: string) => value.replace(",", ".");
```

---

## Áreas Verificadas Sin Problemas

Las siguientes áreas fueron revisadas explícitamente y no presentan problemas significativos:

### Supabase Client-Side (verificado ✓)
- El cliente browser usa correctamente `NEXT_PUBLIC_SUPABASE_ANON_KEY` (clave pública, safe para el cliente).
- `SUPABASE_SERVICE_ROLE_KEY` solo se usa en `createAdminClient()` dentro de `server.ts`, que es un módulo server-only. No hay riesgo de filtración al cliente.
- Las funciones `SECURITY DEFINER` (`is_group_member`, `handle_new_user`) validan correctamente `auth.uid()` internamente.
- El middleware refresca tokens de sesión expirados vía `supabase.auth.getUser()`, que es el patrón recomendado por Supabase.

### Cascada de eliminación de grupos (verificado ✓)
- Eliminar un grupo completo funciona correctamente: `members`, `expenses`, `expense_splits` y `settlements` todos tienen `ON DELETE CASCADE` desde `groups(id)`. PostgreSQL procesa las cascadas en una misma transacción, por lo que no hay datos huérfanos.

### Eliminación de gastos → splits (verificado ✓)
- `expense_splits.expense_id` tiene `ON DELETE CASCADE` desde `expenses(id)`. Al eliminar un gasto, sus splits se eliminan automáticamente.

### Algoritmo de transferencias (verificado ✓)
- El algoritmo greedy en `calculateOptimizedTransfers` es correcto y eficiente:
  - Complejidad: O(M log M) para sort + O(M) para el pass greedy, donde M = número de miembros.
  - Umbral de 0.005 para filtrar sub-céntimos por redondeo.
  - Todas las operaciones aritméticas usan `Math.round(x * 100) / 100` consistentemente.
  - La BD almacena en `DECIMAL(10,2)`, que es aritmética exacta para 2 decimales.
  - El remainder distribution en `calculateSplits` (ej: 100€/3 = 33.33 + 33.33 + 33.34) es correcto.
  - **Nota:** El algoritmo greedy no minimiza el número de transferencias (eso requeriría un algoritmo más complejo como subset-sum), pero es suficiente para grupos típicos (< 20 personas).

### Seguridad de inyección SQL (verificado ✓)
- Todas las queries usan el cliente de Supabase, que parametriza automáticamente los valores. No hay concatenación de SQL en ningún punto del código.

### Supabase Realtime (verificado ✓)
- NO se usa Supabase Realtime, ni hay WebSockets abiertos. Esto es aceptable para el alcance actual (gastos compartidos donde los cambios no son frecuentes). Si se añaden notificaciones en el futuro, considerar Realtime para la actualización de la UI.

### Entropía de invite codes (verificado ✓)
- `encode(gen_random_bytes(6), 'hex')` genera 12 caracteres hex = 48 bits de entropía = ~281 billones de combinaciones. Es suficiente para prevenir fuerza bruta incluso sin rate limiting. Sin embargo, el hallazgo #1 (grupos visibles para todos) hace que los invite_codes no sean secretos en la práctica actual.

### Formularios móvil (parcialmente verificado ✓)
- `inputMode="decimal"` se usa correctamente en inputs de montos.
- Los botones principales tienen `h-11` (44px) o `h-12` (48px), cumpliendo el mínimo recomendado de 44px para targets táctiles.
- Los checkboxes de participantes están dentro de labels con `py-2.5`, dando un área de tap adecuada.

---

## Plan de Acción Recomendado

### Bloque 1: Seguridad RLS + Race Condition (Urgente)
- Crear migración 006 que:
  - Elimine la política permisiva de groups SELECT (#1)
  - Restrinja la política de members UPDATE (#2)
  - Elimine la política de members SELECT para placeholders (#3)
  - Cree funciones RPC para el flujo de invitación (`get_group_preview_by_invite`, `get_group_placeholders`)
- Corregir la race condition en vinculación de placeholders: añadir `WHERE user_id IS NULL` al UPDATE del admin client (#20)
- Actualizar `getGroupByInviteCode` y `joinGroup` para usar las RPCs
- Actualizar `join/[code]/page.tsx` para usar las nuevas funciones
- Validar el parámetro `next` en auth callback (#17)
- Verificar que todo el flujo de join siga funcionando end-to-end

### Bloque 2: Headers de Seguridad + Configuración
- Configurar headers de seguridad HTTP en `next.config.ts` (#21)
- Documentar `SUPABASE_SERVICE_ROLE_KEY` en `.env.local.example` (#27)
- Corregir `userScalable: false` en viewport (#26)

### Bloque 3: Validación y Consistencia del Servidor
- Añadir validación de longitudes y rangos máximos en server actions (#4)
- Unificar el patrón de manejo de errores (#5)
- Añadir verificación de ownership en edición/eliminación de gastos (#10)
- Considerar adoptar Zod para validación estructurada

### Bloque 4: Integridad de Datos
- Crear RPC para inserción atómica de expenses + splits (#9)
- Crear RPC para actualización atómica de expenses + splits
- Arreglar atomicidad de `createGroup` (#34)
- Migrar `createExpense` y `updateExpense` para usar las RPCs
- Corregir FKs sin CASCADE y decidir estrategia de eliminación de usuarios (#22)
- Añadir índices compuestos (#29)

### Bloque 5: Performance
- Optimizar `getMyGroups` con una sola query o RPC (#8)
- Mover la carga de datos de las tabs al server component (#6)
- Implementar carga condicional de tabs (solo montar la activa) (#19)
- Eliminar recarga completa tras operaciones CRUD (#7)
- Considerar caching para cálculo de balances (#28)

### Bloque 6: Rate Limiting
- Implementar rate limiting en middleware o a nivel de Supabase (#23)
- Priorizar: creación de grupos, gastos, y vinculación de placeholders

### Bloque 7: Testing + Observabilidad
- Configurar vitest (#24)
- Escribir tests para `calculateSplits` y `calculateOptimizedTransfers`
- Escribir tests para validación de server actions
- Integrar Sentry o similar para error tracking (#25)
- Añadir logging estructurado en server actions

### Bloque 8: Limpieza de Código + Accesibilidad
- Extraer constantes compartidas (#11)
- Eliminar `getInitials` duplicada (#12)
- Eliminar tipos y dependencias no usadas (#13)
- Extraer componente `SettlementHistory` compartido (#15)
- Migrar `require()` a `await import()` en admin client (#14)
- Resolver el service worker (#18)
- Añadir skeleton screens (#16)
- Añadir aria-labels a botones con iconos (#32)
- Reorganizar componentes en subcarpetas (#31)
