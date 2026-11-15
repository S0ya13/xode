import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  createChatCanvasStore,
  resolveChatCanvasModel,
  type ChatCanvasMeasurements,
} from "./canvasStore";
import type { ChatCanvasPreview } from "./chatCanvasLayout";

const threadRef = {
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-1"),
};
const measurements = (width: number, height = 900): ChatCanvasMeasurements => ({
  width,
  height,
  padding: 48,
  maxChatWidth: 768,
  minChatWidth: 640,
  composerHeight: 180,
  timelineGutter: 0,
  findBar: null,
});
const preview: ChatCanvasPreview = {
  key: "browser:one",
  width: 320,
  position: null,
  source: { width: 1600, height: 1000 },
};

describe("chat canvas model", () => {
  // Fork: the details card opens from the header as a popover and never sits beside the chat.
  it("always shows the details card as a popover and keeps the canvas free of it", () => {
    const resolve = (width: number) =>
      resolveChatCanvasModel({
        measurements: measurements(width, 300),
        detailsCardMeasurement: { threadRef, width: 280, fullContentHeight: 400 },
        threadRef,
        preview: { ...preview, position: { x: 760, y: 150 }, lastInteraction: "drag" },
        detailsCardInlineOpen: true,
      });
    for (const width of [900, 1100, 1400]) {
      expect(resolve(width).detailsCardMode).toBe("popover");
      expect(resolve(width).detailsCardPlacement).toBeNull();
      expect(resolve(width).layout.overlapsDetailsCard).toBe(false);
    }
  });

  it("keeps state identity when a measurement repeats", () => {
    const store = createChatCanvasStore();
    store.getState().setMeasurements(measurements(1400));
    const before = store.getState();
    store.getState().setMeasurements(measurements(1400));
    store.getState().measureDetailsCard({ threadRef, width: 280, fullContentHeight: 300 });
    const measured = store.getState();
    store.getState().measureDetailsCard({ threadRef, width: 280, fullContentHeight: 300 });
    expect(measured.measurements).toBe(before.measurements);
    expect(store.getState()).toBe(measured);
    store.getState().setMeasurements({ ...measurements(1400), narrowestWidth: 900 });
    expect(store.getState().measurements.narrowestWidth).toBe(900);
    expect(store.getState()).not.toBe(measured);
  });
});
