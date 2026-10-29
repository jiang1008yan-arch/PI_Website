import { useEffect, useState } from "react";
import { api } from "../api/client";

// The after-sales bot's name as Feishu shows it, for instructions that tell
// people which bot to add or message. Falls back to a generic name until (or
// unless) the server can read it from Feishu.
const FALLBACK = "the after-sales bot";
let cached: string | null = null;

export function useBotName(): string {
  const [name, setName] = useState(cached ?? FALLBACK);
  useEffect(() => {
    if (cached) return;
    api
      .get("/feishu/bot")
      .then((res) => {
        const value = (res.data as { name: string | null }).name;
        if (value) {
          cached = value;
          setName(value);
        }
      })
      .catch(() => undefined);
  }, []);
  return name;
}
