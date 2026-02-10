# SplitTrip — Arquitectura de Producto y Base de Datos

## 1. Visión del Producto

SplitTrip es una aplicación web de gestión de gastos compartidos, orientada principalmente a viajes en grupo. Permite crear grupos, añadir gastos, dividirlos de múltiples formas entre los miembros, y calcular las transferencias mínimas necesarias para saldar todas las deudas.

---

## 2. Tech Stack

| Capa | Tecnología | Justificación |
|------|-----------|---------------|
| Frontend | Next.js 14+ (App Router) + React + Tailwind CSS | Stack unificado, excelente DX con Claude Code, camino a React Native |
| Backend | Next.js API Routes (Server Actions) | Todo en un proyecto, sin backend separado para MVP |
| Base de datos | PostgreSQL via Supabase | Gratis para MVP, auth integrada, real-time ready |
| Autenticación | Supabase Auth (Google OAuth) | Login con Google out-of-the-box |
| Almacenamiento | Supabase Storage (futuro) | Para fotos de tickets cuando se implemente |
| Despliegue | Vercel | Deploy automático, dominio gratis, edge functions |

---

## 3. Modelo de Datos

### 3.1 Diagrama de Entidades

```
┌──────────────┐       ┌──────────────────┐       ┌──────────────────┐
│    users     │       │      groups      │       │    members       │
│──────────────│       │──────────────────│       │──────────────────│
│ id (PK)      │       │ id (PK)          │       │ id (PK)          │
│ email        │       │ name             │       │ group_id (FK)    │
│ display_name │       │ description      │       │ user_id (FK)?    │
│ avatar_url   │       │ status           │       │ display_name     │
│ created_at   │       │ created_by (FK)  │       │ created_at       │
└──────┬───────┘       │ invite_code      │       └──────────────────┘
       │               │ frozen_at        │
       │               │ archived_at      │
       │               │ created_at       │
       │               └────────┬─────────┘
       │                        │
       │    ┌───────────────────┼───────────────────┐
       │    │                   │                   │
       │    ▼                   ▼                   ▼
       │  ┌──────────────┐  ┌──────────────────┐  ┌──────────────────┐
       │  │   expenses   │  │ expense_splits   │  │  settlements     │
       │  │──────────────│  │──────────────────│  │──────────────────│
       │  │ id (PK)      │  │ id (PK)          │  │ id (PK)          │
       │  │ group_id(FK) │  │ expense_id (FK)  │  │ group_id (FK)    │
       │  │ paid_by (FK) │  │ member_id (FK)   │  │ from_member (FK) │
       │  │ description  │  │ amount           │  │ to_member (FK)   │
       │  │ amount       │  │ created_at       │  │ amount           │
       │  │ split_type   │  └──────────────────┘  │ settled_at       │
       │  │ image_url    │                        │ created_at       │
       │  │ created_by   │                        └──────────────────┘
       │  │ created_at   │
       │  └──────────────┘
       │
       └──── user_id en members (nullable, se vincula cuando el usuario se une)
```

### 3.2 Tablas Detalladas

#### `users`
Usuarios registrados con cuenta de Google.

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | UUID (PK) | Generado por Supabase Auth |
| `email` | TEXT NOT NULL UNIQUE | Email de Google |
| `display_name` | TEXT NOT NULL | Nombre visible |
| `avatar_url` | TEXT | Foto de perfil de Google |
| `created_at` | TIMESTAMPTZ | Default NOW() |

#### `groups`
Grupos de gastos (típicamente un viaje).

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | UUID (PK) | |
| `name` | TEXT NOT NULL | "Viaje a Portugal 2025" |
| `description` | TEXT | Opcional |
| `status` | ENUM | `active`, `settling`, `archived` |
| `created_by` | UUID (FK → users) | Creador del grupo |
| `invite_code` | TEXT UNIQUE | Código para generar link de invitación |
| `frozen_at` | TIMESTAMPTZ | Timestamp de cuándo se congelaron las cuentas |
| `archived_at` | TIMESTAMPTZ | NULL = no archivado |
| `created_at` | TIMESTAMPTZ | Default NOW() |

**Estados del grupo:**
- `active` → Se pueden añadir gastos. Balances dinámicos.
- `settling` → Se activó al crear el primer settlement. Se pueden seguir añadiendo gastos (con aviso), lo que recalcula todo.
- `archived` → Grupo archivado. Solo lectura. Puede tener deudas pendientes (con aviso al archivar).

#### `members`
Miembros de un grupo. Pueden ser placeholders (sin usuario vinculado) o vinculados a un usuario registrado.

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | UUID (PK) | |
| `group_id` | UUID (FK → groups) | |
| `user_id` | UUID (FK → users) | **NULLABLE** — NULL = placeholder |
| `display_name` | TEXT NOT NULL | Nombre visible en el grupo |
| `created_at` | TIMESTAMPTZ | |

**Índice único:** `(group_id, user_id)` WHERE `user_id IS NOT NULL` — un usuario solo puede vincularse una vez por grupo.

#### `expenses`
Gastos individuales dentro de un grupo.

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | UUID (PK) | |
| `group_id` | UUID (FK → groups) | |
| `paid_by` | UUID (FK → members) | Quién pagó |
| `description` | TEXT NOT NULL | "Cena en restaurante" |
| `amount` | DECIMAL(10,2) NOT NULL | Importe total |
| `split_type` | ENUM | `equal`, `exact`, `percentage`, `shares` |
| `image_url` | TEXT | Futuro: URL de la foto del ticket |
| `created_by` | UUID (FK → members) | Quién registró el gasto (puede ser otro) |
| `created_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

#### `expense_splits`
Cuánto corresponde a cada miembro en cada gasto. Se calcula al crear/editar el gasto y se almacena explícitamente.

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | UUID (PK) | |
| `expense_id` | UUID (FK → expenses) | |
| `member_id` | UUID (FK → members) | |
| `amount` | DECIMAL(10,2) NOT NULL | Lo que este miembro debe de este gasto |
| `created_at` | TIMESTAMPTZ | |

**Invariante:** La suma de `amount` en todos los splits de un expense = `expense.amount`.

#### `settlements`
Transferencias calculadas y su estado de liquidación.

| Campo | Tipo | Notas |
|-------|------|-------|
| `id` | UUID (PK) | |
| `group_id` | UUID (FK → groups) | |
| `from_member` | UUID (FK → members) | Quién debe pagar |
| `to_member` | UUID (FK → members) | A quién debe pagar |
| `amount` | DECIMAL(10,2) NOT NULL | Cantidad |
| `settled_at` | TIMESTAMPTZ | NULL = pendiente, fecha = saldado |
| `created_at` | TIMESTAMPTZ | |

---

## 4. Funcionalidades Clave y Lógica de Negocio

### 4.1 Creación de Grupo y Gestión de Miembros

**Crear grupo:**
1. Usuario registrado crea un grupo con nombre.
2. Se genera automáticamente un `invite_code` único.
3. El creador se añade como miembro vinculado (member con user_id).

**Añadir miembros placeholder:**
1. Cualquier miembro añade nombres al grupo (ej: "María", "Pedro").
2. Se crean registros en `members` con `user_id = NULL`.

**Flujo de invitación y vinculación:**
1. Se comparte un link tipo `app.com/join/{invite_code}`.
2. El usuario abre el link → si no está logueado, se le pide login con Google.
3. Tras login, se le muestra un popup con los miembros del grupo.
4. El usuario elige: vincularse a un placeholder existente O crear un nuevo miembro.
5. Si elige un placeholder → se actualiza `members.user_id` con su ID.
6. Todos los gastos donde ese placeholder participaba ahora pertenecen al usuario.

### 4.2 Registro de Gastos

**Crear un gasto:**
1. Seleccionar quién pagó (member).
2. Introducir descripción y cantidad total.
3. Seleccionar tipo de división: `equal`, `exact`, `percentage`, `shares`.
4. Seleccionar participantes (por defecto todos, con opción de deseleccionar).
5. Según el tipo de división, introducir los valores correspondientes.
6. Opcionalmente adjuntar foto (futuro).

**Cálculo de splits por tipo:**

| Tipo | Lógica |
|------|--------|
| `equal` | `amount / num_participantes`. Céntimo extra al primer participante si no es exacto. |
| `exact` | El usuario introduce la cantidad exacta por persona. Validar que la suma = total. |
| `percentage` | El usuario introduce % por persona. Validar que suma = 100%. Calcular importes. |
| `shares` | El usuario asigna "partes" (ej: 2, 1, 1). Calcular: `amount * (mis_partes / total_partes)`. |

**Editar/Eliminar gasto:**
- Cualquier miembro puede hacerlo.
- Se recalculan los splits al editar.
- Si el grupo está en estado `settling`, editar/añadir/eliminar un gasto dispara un recálculo de settlements (ver sección 4.4).

### 4.3 Cálculo de Balances

Los balances se calculan en tiempo real a partir de los datos almacenados.

**Balance de un miembro = Lo que ha pagado − Lo que debe**

```
Para cada miembro M:
  total_pagado = SUM(expenses.amount) WHERE paid_by = M
  total_debe   = SUM(expense_splits.amount) WHERE member_id = M
  balance = total_pagado - total_debe
```

- Balance positivo → Le deben dinero.
- Balance negativo → Debe dinero.
- La suma de todos los balances de un grupo siempre es 0.

### 4.4 Algoritmo de Optimización de Transferencias

El objetivo es minimizar el número de transferencias para saldar todas las deudas.

**Algoritmo (greedy simplificado):**

```
1. Calcular balance neto de cada miembro.
2. Separar en deudores (balance < 0) y acreedores (balance > 0).
3. Ordenar deudores por deuda (mayor primero) y acreedores por crédito (mayor primero).
4. Mientras queden deudas:
   a. Tomar el mayor deudor y el mayor acreedor.
   b. La transferencia = min(abs(deuda), crédito).
   c. Crear settlement: deudor → acreedor por esa cantidad.
   d. Actualizar balances.
   e. Si alguno queda en 0, eliminarlo de la lista.
```

Este algoritmo produce transferencias óptimas o casi óptimas para grupos pequeños/medianos.

### 4.5 Flujo de Liquidación (Settling)

**Estado `active` → `settling`:**
1. Mientras el grupo está activo, los balances y transferencias sugeridas se muestran en tiempo real pero son dinámicos.
2. Cuando alguien marca la primera transferencia como saldada → el grupo pasa a estado `settling` automáticamente.

**En estado `settling`:**
- Se muestran las transferencias calculadas como lista fija.
- Cada transferencia se puede marcar como "saldada" individualmente.
- Si alguien añade/edita/elimina un gasto:
  - Se muestra un aviso: "Las cuentas están en proceso de liquidación. ¿Quieres añadir un gasto? Esto recalculará las transferencias pendientes."
  - Si confirma: se recalculan TODAS las transferencias, **teniendo en cuenta las ya saldadas como pagos realizados**.
  - Lógica del recálculo:
    1. Calcular balances netos desde cero (todos los gastos).
    2. Restar los settlements ya saldados de los balances correspondientes.
    3. Con los balances ajustados, ejecutar de nuevo el algoritmo de optimización.
    4. Generar nuevos settlements para las cantidades restantes.

**Estado `settling` → `archived`:**
- Cualquier miembro puede archivar el grupo.
- Si quedan transferencias pendientes → aviso antes de confirmar.
- El grupo pasa a solo lectura y se mueve de la vista principal al histórico.

### 4.6 Historial de Liquidaciones

Se mantiene un registro de todas las transferencias (settlements), con su fecha de saldo. Esto permite:
- Ver qué se ha pagado y cuándo.
- Resolver disputas si alguien dice que ya pagó.
- Auditar el flujo completo de dinero del grupo.

---

## 5. Estructura de Pantallas (MVP)

### 5.1 Pantallas Principales

```
1. LOGIN
   └── Google Sign-In

2. HOME (lista de grupos)
   ├── Grupos activos / en liquidación
   ├── Botón "Crear grupo"
   ├── Acceso a grupos archivados
   └── Banner si llegas con invite_code → popup de vinculación

3. GRUPO (detalle)
   ├── Header: nombre, estado, miembros
   ├── Tab: GASTOS
   │   ├── Lista cronológica de gastos
   │   ├── Cada gasto: descripción, importe, pagador, split
   │   ├── Tap en gasto → detalle con splits y foto (futuro)
   │   └── Botón "Añadir gasto"
   ├── Tab: BALANCES
   │   ├── Balance neto de cada miembro
   │   └── Lista de transferencias optimizadas
   │       ├── "María debe 45.30€ a Pedro" [Marcar como saldada]
   │       └── Estado: pendiente / saldada (con fecha)
   └── Tab: AJUSTES
       ├── Miembros (añadir placeholder, ver vinculados)
       ├── Link de invitación (copiar/compartir)
       ├── Archivar grupo
       └── Historial de liquidaciones

4. AÑADIR/EDITAR GASTO
   ├── Pagador (selector de miembro)
   ├── Descripción
   ├── Cantidad total
   ├── Tipo de división (equal/exact/percentage/shares)
   ├── Participantes (checkboxes, todos por defecto)
   ├── Inputs dinámicos según tipo de división
   └── Foto del ticket (futuro)

5. FLUJO DE INVITACIÓN
   └── /join/{invite_code}
       ├── Si no logueado → login → redirect aquí
       └── Popup: "¿Quién eres?" → lista de placeholders + "Crear nuevo"
```

---

## 6. Políticas de Seguridad (Row Level Security - Supabase)

| Tabla | Quién puede leer | Quién puede escribir |
|-------|-------------------|----------------------|
| `groups` | Miembros del grupo (via members) | Cualquier usuario autenticado (crear); miembros (editar) |
| `members` | Miembros del grupo | Miembros del grupo |
| `expenses` | Miembros del grupo | Miembros del grupo (si grupo no archivado) |
| `expense_splits` | Miembros del grupo | Sistema (se crean al crear/editar expense) |
| `settlements` | Miembros del grupo | Miembros del grupo (si grupo no archivado) |

**Nota importante:** Los miembros placeholder (sin user_id) no tienen acceso directo. Solo los miembros vinculados a un usuario pueden operar. Pero cualquier miembro vinculado puede crear gastos y asignarlos a placeholders.

---

## 7. API Routes (Endpoints principales)

```
POST   /api/groups                    → Crear grupo
GET    /api/groups                    → Listar mis grupos
GET    /api/groups/:id                → Detalle de grupo
PATCH  /api/groups/:id                → Editar grupo (archivar, etc.)
POST   /api/groups/:id/members        → Añadir miembro placeholder
POST   /api/groups/join/:invite_code  → Unirse y vincularse
GET    /api/groups/:id/expenses       → Listar gastos
POST   /api/groups/:id/expenses       → Crear gasto (+ splits)
PATCH  /api/groups/:id/expenses/:eid  → Editar gasto
DELETE /api/groups/:id/expenses/:eid  → Eliminar gasto
GET    /api/groups/:id/balances       → Balances calculados + transferencias
POST   /api/groups/:id/settlements    → Marcar transferencia como saldada
GET    /api/groups/:id/settlements    → Historial de liquidaciones
```

---

## 8. Decisiones Técnicas Clave

### 8.1 Splits almacenados vs. calculados
Los splits se **almacenan explícitamente** en `expense_splits`. Aunque los splits equitativos podrían calcularse al vuelo, almacenarlos garantiza:
- Consistencia (no hay redondeos diferentes en distintos momentos).
- Rendimiento (no recalcular en cada consulta).
- Flexibilidad (todos los tipos de split se tratan igual).

### 8.2 Settlements calculados vs. almacenados
Las transferencias optimizadas se **calculan al vuelo** mientras el grupo está activo. Se **almacenan en `settlements`** cuando se crea la primera liquidación (transición a `settling`). Esto permite:
- Dinamismo total mientras se añaden gastos.
- Persistencia y trazabilidad cuando empiezan los pagos.

### 8.3 Manejo de céntimos
Para divisiones equitativas que no son exactas (ej: 100€ / 3 = 33.33€), se asigna el céntimo extra al primer participante. Todos los importes se almacenan como `DECIMAL(10,2)`.

### 8.4 Preparación para app móvil
Al usar Next.js API Routes como backend, cuando se quiera crear una app móvil en React Native, se pueden consumir los mismos endpoints. Alternativa futura: migrar a Supabase directamente desde el cliente móvil con RLS.

### 8.5 Preparación para notificaciones
El modelo ya permite añadir notificaciones:
- Trigger en `expenses` INSERT → notificar a miembros del grupo.
- Trigger en `settlements` UPDATE (settled_at) → notificar al acreedor.
- Implementable con Supabase Realtime + push notifications futuras.

### 8.6 Preparación para fotos de tickets
El campo `image_url` en `expenses` ya está previsto. Cuando se active:
- Subir imagen a Supabase Storage (bucket privado por grupo).
- Almacenar la URL pública/firmada en `image_url`.
- Mostrar en el detalle del gasto con zoom.

---

## 9. Roadmap sugerido

### MVP (v1)
- [ ] Auth con Google (Supabase Auth)
- [ ] Crear grupo + invite link
- [ ] Añadir miembros placeholder
- [ ] Flujo de vinculación por invite link
- [ ] CRUD de gastos con 4 tipos de división
- [ ] Selección/deselección de participantes por gasto
- [ ] Cálculo de balances en tiempo real
- [ ] Algoritmo de transferencias optimizadas
- [ ] Marcar transferencias como saldadas
- [ ] Estado settling con recálculo al añadir gastos
- [ ] Archivar grupo (con aviso si quedan deudas)
- [ ] Historial de liquidaciones
- [ ] PWA básica (installable en móvil)

### v2
- [ ] Fotos de tickets (Supabase Storage)
- [ ] Categorías de gastos
- [ ] Notificaciones (push/email)
- [ ] Multi-moneda con conversión

### v3
- [ ] App móvil nativa (React Native)
- [ ] Modo offline con sincronización
- [ ] OCR de tickets
- [ ] Exportar resumen a PDF
