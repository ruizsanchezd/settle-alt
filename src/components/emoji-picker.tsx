"use client";

import { useState } from "react";

const EMOJI_LIST = [
  "✈️", "🏖️", "🏔️", "🏠", "🎉", "🍽️", "🍕", "🍻",
  "🎵", "⚽", "🎮", "🛒", "💼", "🎓", "❤️", "🚗",
  "🏕️", "🎂", "🎄", "🎃", "👨‍👩‍👧‍👦", "🏋️", "🎬", "📚",
  "🐶", "🌮", "☕", "🎁", "🏡", "💡", "🎯", "🌍",
];

interface EmojiPickerProps {
  value: string | null;
  onChange: (emoji: string | null) => void;
}

export function EmojiPicker({ value, onChange }: EmojiPickerProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-2xl transition-colors hover:bg-muted/80"
      >
        {value || "😀"}
      </button>
      {open && (
        <div className="grid grid-cols-8 gap-1 rounded-xl border bg-background p-2">
          {EMOJI_LIST.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => {
                onChange(emoji);
                setOpen(false);
              }}
              className={`flex h-9 w-9 items-center justify-center rounded-lg text-xl transition-colors hover:bg-muted ${
                value === emoji ? "bg-muted ring-2 ring-primary" : ""
              }`}
            >
              {emoji}
            </button>
          ))}
          {value && (
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              className="col-span-8 mt-1 rounded-lg py-1.5 text-xs text-muted-foreground hover:bg-muted"
            >
              Quitar emoji
            </button>
          )}
        </div>
      )}
    </div>
  );
}
