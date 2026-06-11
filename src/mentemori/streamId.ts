export type GvgStreamId = number & { readonly __brand: "GvgStreamId" };

export type GvgStreamScope = {
  castleId: number;
  block: number;
  worldGroupId: number;
  gvgClass: number;
  worldId: number;
};

const CASTLE_ID_BITS = 5;
const BLOCK_BITS = 3;
const WORLD_GROUP_ID_BITS = 8;
const GVG_CLASS_BITS = 3;
const WORLD_ID_BITS = 13;

const CASTLE_ID_SHIFT = 0;
const BLOCK_SHIFT = CASTLE_ID_SHIFT + CASTLE_ID_BITS;
const WORLD_GROUP_ID_SHIFT = BLOCK_SHIFT + BLOCK_BITS;
const GVG_CLASS_SHIFT = WORLD_GROUP_ID_SHIFT + WORLD_GROUP_ID_BITS;
const WORLD_ID_SHIFT = GVG_CLASS_SHIFT + GVG_CLASS_BITS;

const CASTLE_ID_MAX = 2 ** CASTLE_ID_BITS - 1;
const BLOCK_MAX = 2 ** BLOCK_BITS - 1;
const WORLD_GROUP_ID_MAX = 2 ** WORLD_GROUP_ID_BITS - 1;
const GVG_CLASS_MAX = 2 ** GVG_CLASS_BITS - 1;
const WORLD_ID_MAX = 2 ** WORLD_ID_BITS - 1;

export function buildGvgStreamId(scope: GvgStreamScope): GvgStreamId {
  assertBitRange("castleId", scope.castleId, CASTLE_ID_MAX);
  assertBitRange("block", scope.block, BLOCK_MAX);
  assertBitRange("worldGroupId", scope.worldGroupId, WORLD_GROUP_ID_MAX);
  assertBitRange("gvgClass", scope.gvgClass, GVG_CLASS_MAX);
  assertBitRange("worldId", scope.worldId, WORLD_ID_MAX);

  return (((scope.castleId << CASTLE_ID_SHIFT) |
    (scope.block << BLOCK_SHIFT) |
    (scope.worldGroupId << WORLD_GROUP_ID_SHIFT) |
    (scope.gvgClass << GVG_CLASS_SHIFT) |
    (scope.worldId << WORLD_ID_SHIFT)) >>>
    0) as GvgStreamId;
}

export function decodeGvgStreamId(streamId: GvgStreamId | number): GvgStreamScope {
  const value = streamId >>> 0;

  return {
    castleId: (value >>> CASTLE_ID_SHIFT) & CASTLE_ID_MAX,
    block: (value >>> BLOCK_SHIFT) & BLOCK_MAX,
    worldGroupId: (value >>> WORLD_GROUP_ID_SHIFT) & WORLD_GROUP_ID_MAX,
    gvgClass: (value >>> GVG_CLASS_SHIFT) & GVG_CLASS_MAX,
    worldId: (value >>> WORLD_ID_SHIFT) & WORLD_ID_MAX,
  };
}

export function createGuildBattleSubscriptionPayload(worldId: string): Uint8Array {
  const numericWorldId = Number(worldId.trim());
  if (!Number.isInteger(numericWorldId)) {
    throw new Error("KOO_WORLD_ID must be an integer for realtime subscription.");
  }

  const streamId = buildGvgStreamId({
    castleId: 0,
    block: 0,
    worldGroupId: 0,
    gvgClass: 0,
    worldId: numericWorldId,
  });
  const payload = new Uint8Array(4);
  new DataView(payload.buffer).setUint32(0, streamId, true);
  return payload;
}

export function createGrandBattleSubscriptionPayload(source: {
  worldGroupId: number;
  classId: number;
  blockId: number;
}): Uint8Array {
  const streamId = buildGvgStreamId({
    castleId: 0,
    block: source.blockId,
    worldGroupId: source.worldGroupId,
    gvgClass: source.classId,
    worldId: 0,
  });
  const payload = new Uint8Array(4);
  new DataView(payload.buffer).setUint32(0, streamId, true);
  return payload;
}

function assertBitRange(name: string, value: number, max: number): void {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new Error(`${name} must be an integer between 0 and ${max}.`);
  }
}
