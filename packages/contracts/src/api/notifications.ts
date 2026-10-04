import { z } from "zod";
import { NOTIFICATION_CHANNELS, NOTIFICATION_EVENTS } from "../client";

export const NotificationEventSchema = z.enum(NOTIFICATION_EVENTS);
export type NotificationEvent = z.infer<typeof NotificationEventSchema>;

export const NotificationChannelSchema = z.enum(NOTIFICATION_CHANNELS);
export type NotificationChannel = z.infer<typeof NotificationChannelSchema>;

export const NotificationEventsSchema = z.object({
  RUN_FINISHED: z.boolean(),
  RUN_FAILED: z.boolean(),
  RUN_BLOCKED: z.boolean(),
  APPROVAL: z.boolean(),
  BUDGET: z.boolean(),
  QUOTA: z.boolean(),
  CHECKS: z.boolean().default(true),
});
export type NotificationEvents = z.infer<typeof NotificationEventsSchema>;

const HttpUrlSchema = z
  .url({ protocol: /^https?$/ })
  .max(500)
  .refine((value) => !/\s/.test(value), "The address must not contain spaces");

export const NotificationSettingsDtoSchema = z.object({
  events: NotificationEventsSchema,
  webPush: z.object({
    enabled: z.boolean(),
    devices: z.number().int(),
  }),
  ntfy: z.object({
    enabled: z.boolean(),
    server: z.string(),
    topic: z.string(),
    hasToken: z.boolean(),
  }),
  telegram: z.object({
    enabled: z.boolean(),
    chatId: z.string(),
    hasToken: z.boolean(),
  }),
  linkBase: z.string().nullable(),
});
export type NotificationSettingsDto = z.infer<typeof NotificationSettingsDtoSchema>;

const SecretUpdateSchema = z.string().trim().min(1).max(500).nullable().optional();

export const UpdateNotificationSettingsRequestSchema = z.object({
  events: NotificationEventsSchema.optional(),
  webPush: z.object({ enabled: z.boolean() }).optional(),
  ntfy: z
    .object({
      enabled: z.boolean(),
      server: z.union([HttpUrlSchema, z.literal("")]),
      topic: z
        .string()
        .trim()
        .max(64)
        .regex(/^[A-Za-z0-9_-]*$/, "Use letters, digits, - and _ only"),
      token: SecretUpdateSchema,
    })
    .refine((value) => !value.enabled || (value.server !== "" && value.topic !== ""), {
      message: "Enter the server and the topic",
      path: ["topic"],
    })
    .optional(),
  telegram: z
    .object({
      enabled: z.boolean(),
      chatId: z
        .string()
        .trim()
        .max(64)
        .regex(/^(-?\d+|@[A-Za-z0-9_]{5,})?$/, "A chat id is a number or @channel"),
      token: SecretUpdateSchema,
    })
    .optional(),
});
export type UpdateNotificationSettingsRequest = z.input<
  typeof UpdateNotificationSettingsRequestSchema
>;

export const PushSubscriptionRequestSchema = z.object({
  endpoint: z.url({ protocol: /^https$/ }).max(2000),
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{16,32}$/),
  }),
});
export type PushSubscriptionRequest = z.input<typeof PushSubscriptionRequestSchema>;

export const PushUnsubscribeRequestSchema = z.object({ endpoint: z.string().max(2000) });

export const PushKeyResponseSchema = z.object({ publicKey: z.string() });
export type PushKeyResponse = z.infer<typeof PushKeyResponseSchema>;

export const TestNotificationRequestSchema = z.object({ channel: NotificationChannelSchema });

export const TestNotificationResponseSchema = z.object({
  ok: z.boolean(),
  detail: z.string(),
});
export type TestNotificationResponse = z.infer<typeof TestNotificationResponseSchema>;
