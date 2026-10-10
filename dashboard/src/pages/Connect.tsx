import { useState } from "react";
import { Button, Card, PageTitle } from "../components/ui";
import { saveConnection, savedConnection, useSource } from "../data/store";

const FIELD = "mt-1 w-full rounded-input border-2 border-line bg-paper px-3 py-2 font-mono text-sm";

export function Connect() {
  const source = useSource();
  const saved = savedConnection();
  const [url, setUrl] = useState(saved?.url ?? "");
  const [token, setToken] = useState(saved?.token ?? "");
  const valid = /^https?:\/\/[^\s/]+/.test(url.trim());

  return (
    <div className="space-y-6">
      <PageTitle title="Hisn server" lead={source.kind === "live" ? "Connected to a live vault." : "Showing sample data."} />
      <Card>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            saveConnection({ url, token });
            window.location.assign(import.meta.env.BASE_URL);
          }}
        >
          <label className="block">
            <span className="text-sm font-bold">Server address</span>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" autoComplete="off" spellCheck={false} className={FIELD} />
          </label>
          <label className="block">
            <span className="text-sm font-bold">Access key</span>
            <input value={token} onChange={(e) => setToken(e.target.value)} type="password" autoComplete="off" spellCheck={false} className={FIELD} />
          </label>
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={!valid}>
              Connect
            </Button>
            {saved && (
              <Button
                look="quiet"
                onClick={() => {
                  saveConnection(null);
                  window.location.assign(import.meta.env.BASE_URL);
                }}
              >
                Use sample data
              </Button>
            )}
          </div>
        </form>
      </Card>
    </div>
  );
}
