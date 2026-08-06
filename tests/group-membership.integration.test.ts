import { describe, expect, it } from "vitest";
import { createBot } from "../src/toolkit/index.js";
import groupCheck from "../src/handlers/group-check.js";
import type { Session } from "../src/bot.js";
import { callbackUpdate } from "../src/toolkit/harness/updates.js";

type UserRow = {
  telegram_id: number;
  username: string | null;
  group_member: number;
  tier: "free" | "standard" | "pro";
  expiry_date: string | null;
  credits: number;
};

/** Minimal D1 double: it exercises the actual durable user read/write path. */
function membershipDatabase() {
  const users = new Map<number, UserRow>();
  const configuredGroupId = "-1001234567890";

  return {
    users,
    DB: {
      prepare(query: string) {
        let values: unknown[] = [];
        return {
          bind(...next: unknown[]) {
            values = next;
            return this;
          },
          async run() {
            if (query.startsWith("INSERT INTO iu_users")) {
              users.set(Number(values[0]), {
                telegram_id: Number(values[0]),
                username: (values[1] as string | null) ?? null,
                group_member: Number(values[2]),
                tier: values[3] as UserRow["tier"],
                expiry_date: (values[4] as string | null) ?? null,
                credits: Number(values[5]),
              });
            }
            return {};
          },
          async first<T>() {
            if (query.startsWith("SELECT * FROM iu_users")) {
              return (users.get(Number(values[0])) ?? null) as T | null;
            }
            return null;
          },
          async all<T>() {
            if (query.startsWith("SELECT key, value FROM iu_settings")) {
              return { results: [{ key: "group_chat_id", value: configuredGroupId }] as T[] };
            }
            return { results: [] as T[] };
          },
        };
      },
    },
  };
}

describe("group membership verification", () => {
  it("uses the configured group and requesting user IDs, then grants the initial credit", async () => {
    const database = membershipDatabase();
    const bot = createBot<Session>("test-token", { initial: () => ({}) });
    bot.use((ctx, next) => {
      (ctx as typeof ctx & { env: { DB: unknown } }).env = { DB: database.DB };
      return next();
    });
    bot.use(groupCheck);
    bot.botInfo = {
      id: 42, is_bot: true, first_name: "TestBot", username: "test_bot",
      can_join_groups: true, can_read_all_group_messages: false,
      supports_inline_queries: false, can_connect_to_business: false,
      has_main_web_app: false,
    };

    const calls: Array<{ method: string; payload: Record<string, unknown> }> = [];
    bot.api.config.use(async (_previous, method, payload) => {
      calls.push({ method, payload: payload as Record<string, unknown> });
      if (method === "getChatMember") {
        return { ok: true, result: { status: "member" } } as never;
      }
      return { ok: true, result: true } as never;
    });

    await bot.handleUpdate(callbackUpdate(1, "group:check", { userId: 77, chatId: 77 }));

    expect(calls.find((call) => call.method === "getChatMember")?.payload).toMatchObject({
      chat_id: "-1001234567890",
      user_id: 77,
    });
    expect(database.users.get(77)).toMatchObject({ group_member: 1, credits: 1, tier: "free" });
    expect(calls.find((call) => call.method === "sendMessage")?.payload.text).toBe(
      "Your group membership is confirmed. One Standard credit is ready to use.",
    );
  });

  it("explains a Telegram permission failure instead of returning a generic error", async () => {
    const database = membershipDatabase();
    const bot = createBot<Session>("test-token", { initial: () => ({}) });
    bot.use((ctx, next) => {
      (ctx as typeof ctx & { env: { DB: unknown } }).env = { DB: database.DB };
      return next();
    });
    bot.use(groupCheck);
    bot.botInfo = {
      id: 42, is_bot: true, first_name: "TestBot", username: "test_bot",
      can_join_groups: true, can_read_all_group_messages: false,
      supports_inline_queries: false, can_connect_to_business: false,
      has_main_web_app: false,
    };

    const calls: Array<{ method: string; payload: Record<string, unknown> }> = [];
    bot.api.config.use(async (_previous, method, payload) => {
      calls.push({ method, payload: payload as Record<string, unknown> });
      if (method === "getChatMember") {
        return {
          ok: false,
          error_code: 403,
          description: "Forbidden: bot is not a member of the channel chat",
        } as never;
      }
      return { ok: true, result: true } as never;
    });

    await bot.handleUpdate(callbackUpdate(2, "group:check", { userId: 77, chatId: 77 }));

    expect(calls.find((call) => call.method === "getChatMember")?.payload).toMatchObject({
      chat_id: "-1001234567890",
      user_id: 77,
    });
    expect(calls.find((call) => call.method === "sendMessage")?.payload.text).toBe(
      "Couldn’t verify membership. Please make sure the bot is in the group and try again.",
    );
    expect(database.users.get(77)).toBeUndefined();
  });
});
