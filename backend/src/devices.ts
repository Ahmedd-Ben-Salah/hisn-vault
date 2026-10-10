import { EventEmitter } from "node:events";
import type { WebSocket } from "ws";
import { getAddress } from "ethers";
import type { DeviceView } from "./shared.js";

export type DeviceRole = "puck" | "guardian";

export interface Device {
  id: string;
  role: DeviceRole;
  address: string;
  fw: string;
  lastSeen: number;
  ws: WebSocket;
}

export type DeviceMsg = { t: string } & Record<string, unknown>;

export class DeviceHub extends EventEmitter {
  private conns = new Map<string, Device>();
  private known = new Map<string, DeviceView>();
  private timer: NodeJS.Timeout;

  constructor(private watchers: () => string[]) {
    super();
    this.timer = setInterval(() => this.sweep(), 10_000);
  }

  attach(ws: WebSocket, id: string, role: DeviceRole): void {
    const prev = this.conns.get(id);
    if (prev && prev.ws !== ws) prev.ws.close(4000, "replaced");
    const dev: Device = { id, role, address: "", fw: "", lastSeen: Date.now(), ws };
    this.conns.set(id, dev);
    ws.on("message", (raw) => {
      dev.lastSeen = Date.now();
      let msg: DeviceMsg;
      try {
        msg = JSON.parse(String(raw)) as DeviceMsg;
      } catch {
        return;
      }
      if (typeof msg?.t !== "string") return;
      if (msg.t === "ping") {
        this.send(dev, { t: "pong" });
        this.touch(dev);
        return;
      }
      if (msg.t === "pong") return;
      if (msg.t === "hello") {
        try {
          dev.address = getAddress(String(msg.address));
        } catch {
          dev.address = "";
        }
        dev.fw = String(msg.fw ?? "");
        this.touch(dev);
        this.emit("hello", dev);
        return;
      }
      this.emit("message", dev, msg);
    });
    ws.on("close", () => {
      if (this.conns.get(id)?.ws === ws) {
        this.conns.delete(id);
        this.touch(dev, false);
      }
    });
    ws.on("error", () => undefined);
    this.touch(dev);
  }

  private viewRole(dev: Device): DeviceView["role"] {
    if (dev.role === "puck") return "puck";
    const w = this.watchers().map((x) => x.toLowerCase());
    return dev.address && w.includes(dev.address.toLowerCase()) ? "watcher" : "guardian";
  }

  private touch(dev: Device, online = true): void {
    const prev = this.known.get(dev.id);
    const view: DeviceView = { id: dev.id, role: this.viewRole(dev), address: dev.address, online, lastSeen: Math.floor(dev.lastSeen / 1000) };
    this.known.set(dev.id, view);
    if (!prev || prev.online !== view.online || prev.address !== view.address || Math.abs(prev.lastSeen - view.lastSeen) >= 10) {
      this.emit("device", view);
    }
  }

  private sweep(): void {
    const now = Date.now();
    for (const dev of this.conns.values()) {
      if (now - dev.lastSeen > 30_000) {
        dev.ws.terminate();
        continue;
      }
      this.send(dev, { t: "ping" });
    }
  }

  list(): DeviceView[] {
    return [...this.known.values()];
  }

  online(role: DeviceRole): Device[] {
    return [...this.conns.values()].filter((d) => d.role === role);
  }

  send(dev: Device, msg: Record<string, unknown>): boolean {
    if (dev.ws.readyState !== 1) return false;
    dev.ws.send(JSON.stringify(msg));
    return true;
  }

  toRole(role: DeviceRole, msg: Record<string, unknown>): number {
    let n = 0;
    for (const d of this.online(role)) if (this.send(d, msg)) n++;
    return n;
  }

  close(): void {
    clearInterval(this.timer);
    for (const d of this.conns.values()) d.ws.close();
  }
}
