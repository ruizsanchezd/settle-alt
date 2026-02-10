"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus } from "lucide-react";
import { EmojiPicker } from "@/components/emoji-picker";
import { createGroup } from "@/lib/actions/groups";

export function CreateGroupSheet() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emoji, setEmoji] = useState<string | null>(null);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    if (emoji) formData.set("emoji", emoji);
    const result = await createGroup(formData);

    if ("error" in result) {
      setError(result.error);
      setLoading(false);
      return;
    }

    setOpen(false);
    setLoading(false);
    router.push(`/groups/${result.id}`);
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button className="h-12 w-full gap-2 rounded-xl text-sm font-medium">
          <Plus className="h-5 w-5" />
          Crear grupo
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="rounded-t-2xl px-4">
        <SheetHeader>
          <SheetTitle>Nuevo grupo</SheetTitle>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="mt-4 space-y-5 pb-6">
          <div className="space-y-2">
            <Label>Emoji</Label>
            <EmojiPicker value={emoji} onChange={setEmoji} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="name">Nombre del grupo</Label>
            <Input
              id="name"
              name="name"
              placeholder="Ej: Viaje a Portugal 2025"
              required
              maxLength={100}
              className="h-12 rounded-xl"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">
              Descripción{" "}
              <span className="text-muted-foreground">(opcional)</span>
            </Label>
            <Input
              id="description"
              name="description"
              placeholder="Una breve descripción del grupo"
              maxLength={255}
              className="h-12 rounded-xl"
            />
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <Button
            type="submit"
            disabled={loading}
            className="h-12 w-full rounded-xl text-sm font-medium"
          >
            {loading ? "Creando..." : "Crear grupo"}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
