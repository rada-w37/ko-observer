import assert from "node:assert/strict";
import test from "node:test";
import {
  createGrandBattleSubscriptionPayload,
  createGuildBattleSubscriptionPayload,
  decodeGvgStreamId,
} from "./streamId.js";

test("creates Guild Battle subscription payload from worldId", () => {
  const streamId = readStreamId(createGuildBattleSubscriptionPayload("1001"));

  assert.deepEqual(decodeGvgStreamId(streamId), {
    castleId: 0,
    block: 0,
    worldGroupId: 0,
    gvgClass: 0,
    worldId: 1001,
  });
});

test("creates Grand Battle subscription payload from worldGroup class and block", () => {
  const streamId = readStreamId(
    createGrandBattleSubscriptionPayload({
      worldGroupId: 12,
      classId: 3,
      blockId: 2,
    }),
  );

  assert.deepEqual(decodeGvgStreamId(streamId), {
    castleId: 0,
    block: 2,
    worldGroupId: 12,
    gvgClass: 3,
    worldId: 0,
  });
});

function readStreamId(payload: Uint8Array): number {
  return new DataView(payload.buffer).getUint32(0, true);
}
