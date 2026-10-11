import { z } from "zod";

export const ELEMENT_KINDS = ["cast", "location", "prop"] as const;
export type ElementKind = (typeof ELEMENT_KINDS)[number];

export const ASPECTS = ["9:16", "16:9", "1:1"] as const;
export type Aspect = (typeof ASPECTS)[number];

export const RESOLUTIONS = ["720p", "1080p"] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

export const CAMERA_MOVES = ["push-in", "pull-out", "pan-left", "pan-right", "tilt-up", "static"] as const;
export type CameraMove = (typeof CAMERA_MOVES)[number];

export const IMAGE_MODELS = ["sim-image-fast", "sim-image-pro"] as const;
export const VIDEO_MODELS = ["sim-video-lite", "sim-video-pro"] as const;
export type ImageModel = (typeof IMAGE_MODELS)[number];
export type VideoModel = (typeof VIDEO_MODELS)[number];

export type JobKind = "reference" | "frame" | "clip";
export type JobStatus = "queued" | "running" | "retrying" | "done" | "failed";
export type LookStatus = "rendering" | "pending" | "approved" | "rejected" | "reused" | "failed";
export type DecisionKind = "look" | "budget" | "question";

export const filmSpecSchema = z.object({
  briefId: z.string().max(40).optional(),
  brief: z.string().trim().min(20, "Write at least a sentence").max(2000),
  targetSec: z.number().min(5).max(120),
  aspect: z.enum(ASPECTS),
  resolution: z.enum(RESOLUTIONS),
  budget: z.number().int().min(1).max(1000),
  simulateTimeout: z.boolean(),
});
export type FilmSpec = z.infer<typeof filmSpecSchema>;

export const lookSchema = z.object({
  palette: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use #rrggbb colours")).min(2).max(5),
  style: z.string().min(2).max(160),
  mood: z.string().min(2).max(160),
});
export type Look = z.infer<typeof lookSchema>;

export const dialogueLineSchema = z.object({
  speaker: z.string().min(1).max(40).describe("Element id of a cast member"),
  line: z.string().min(1).max(300),
  vo: z.boolean().optional().describe("True for voice-over"),
});
export type DialogueLine = z.infer<typeof dialogueLineSchema>;

export const sceneSchema = z.object({
  n: z.number().int().min(1).max(12),
  heading: z.string().min(3).max(120).describe("INT. or EXT. PLACE - TIME"),
  action: z.string().min(3).max(600).describe("Only what the camera can see and hear"),
  dialogue: z.array(dialogueLineSchema).max(8).default([]),
  durationSec: z.number().min(1).max(60),
  elementIds: z.array(z.string().min(1).max(40)).max(8),
  cameraMove: z.enum(CAMERA_MOVES).default("push-in"),
});
export type SceneInput = z.input<typeof sceneSchema>;
export type Scene = z.output<typeof sceneSchema>;

export const elementSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "Use a short lowercase slug, for example 'baker' or 'stone-bridge'"),
  kind: z.enum(ELEMENT_KINDS),
  name: z.string().min(1).max(60),
  description: z.string().min(3).max(300),
});
export type ElementInput = z.infer<typeof elementSchema>;

export interface Film {
  id: string;
  briefId: string | null;
  brief: string;
  targetSec: number;
  aspect: Aspect;
  resolution: Resolution;
  budget: number;
  simulateTimeout: boolean;
  title: string | null;
  logline: string | null;
  look: Look | null;
  createdAt: number;
}

export interface ElementRow {
  id: string;
  kind: ElementKind;
  name: string;
  description: string;
}

export interface LookRow {
  elementId: string;
  version: number;
  status: LookStatus;
  source: "render" | "library";
  assetId: string | null;
  jobId: string | null;
  note: string | null;
  credits: number;
  createdAt: number;
}

export interface JobRow {
  id: string;
  kind: JobKind;
  target: string;
  idemKey: string;
  model: string;
  resolution: Resolution | null;
  seconds: number | null;
  refInputs: number;
  price: number;
  status: JobStatus;
  attempts: number;
  progress: number;
  errors: { attempt: number; message: string; at: number }[];
  params: Record<string, unknown>;
  assetId: string | null;
  quoteId: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface CutItem {
  scene: number;
  jobId: string;
  in: number;
  out: number;
}

export type CheckStatus = "pass" | "fail" | "fixed";
export interface CheckResult {
  id: string;
  label: string;
  status: CheckStatus;
  problems: string[];
}

export interface DecisionOption {
  id: string;
  label: string;
  detail?: string;
  estimateCredits?: number;
}

export interface Decision {
  id: string;
  kind: DecisionKind;
  message: string;
  status: "open" | "answered" | "cancelled";
  openedBy: "assistant" | "server";
  payload: { elementIds?: string[]; options?: DecisionOption[]; quoteId?: string };
  answer: DecisionAnswer | null;
  createdAt: number;
  answeredAt: number | null;
}

export const decisionAnswerSchema = z.union([
  z.object({
    kind: z.literal("look"),
    looks: z.array(z.object({ elementId: z.string(), verdict: z.enum(["approve", "redo"]), note: z.string().max(200).optional() })).min(1),
  }),
  z.object({ kind: z.literal("option"), optionId: z.string().min(1), note: z.string().max(400).optional() }),
]);
export type DecisionAnswer = z.infer<typeof decisionAnswerSchema>;
