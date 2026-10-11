import type {
  ArcPositionRecord3D as GeneratedArcPositionRecord3D,
  FeedRatePositionRecord3D as GeneratedFeedRatePositionRecord3D,
  OperationRecord3D as GeneratedOperationRecord3D,
  RapidPositionRecord3D as GeneratedRapidPositionRecord3D,
} from "@/generated_schemas/cl_data";

export type FeedType = "rapid" | "feed_rate";

type RapidPositionRecord3D = GeneratedRapidPositionRecord3D & { feedType: "rapid" };
type FeedRatePositionRecord3D = GeneratedFeedRatePositionRecord3D & { feedType: "feed_rate" };
type ArcPositionRecord3D = GeneratedArcPositionRecord3D & { feedType: "arc" };

export type PositionRecord3D =
  | RapidPositionRecord3D
  | FeedRatePositionRecord3D
  | ArcPositionRecord3D;

export type LinearPositionRecord3D = RapidPositionRecord3D | FeedRatePositionRecord3D;

export type OperationRecord3D = Omit<GeneratedOperationRecord3D, "records"> & {
  records: PositionRecord3D[];
};

export type SimulationSamplePoint = LinearPositionRecord3D & {
  sampleIndex: number;
  distanceFromStart: number;
};

const POSITION_EPSILON = 1e-6;
const ARC_CHORD_TOLERANCE = 0.01;

function arePositionsEqual(left: LinearPositionRecord3D, right: LinearPositionRecord3D) {
  return (
    Math.abs(left.x - right.x) <= POSITION_EPSILON &&
    Math.abs(left.y - right.y) <= POSITION_EPSILON &&
    Math.abs(left.z - right.z) <= POSITION_EPSILON
  );
}

function arcSweep(startAngle: number, endAngle: number, clockwise: boolean) {
  const fullTurn = Math.PI * 2;
  if (clockwise) {
    const sweep = -(((startAngle - endAngle) % fullTurn) + fullTurn) % fullTurn;
    return Math.abs(sweep) <= POSITION_EPSILON ? -fullTurn : sweep;
  }
  const sweep = (((endAngle - startAngle) % fullTurn) + fullTurn) % fullTurn;
  return Math.abs(sweep) <= POSITION_EPSILON ? fullTurn : sweep;
}

export function linearizeOperationRecords(
  records: ReadonlyArray<PositionRecord3D>,
  chordTolerance = ARC_CHORD_TOLERANCE,
): LinearPositionRecord3D[] {
  if (records.length === 0) return [];

  const output: LinearPositionRecord3D[] = [];
  for (const record of records) {
    if (record.feedType !== "arc") {
      output.push(record);
      continue;
    }

    const start = output.at(-1);
    if (!start) continue;
    const centerX = start.x + record.centerOffsetX;
    const centerY = start.y + record.centerOffsetY;
    const radius = Math.hypot(start.x - centerX, start.y - centerY);
    if (radius <= POSITION_EPSILON) continue;

    const startAngle = Math.atan2(start.y - centerY, start.x - centerX);
    const endAngle = Math.atan2(record.y - centerY, record.x - centerX);
    const sweep = arcSweep(startAngle, endAngle, record.clockwise);
    const angleStep = chordTolerance >= radius
      ? Math.PI / 8
      : Math.min(Math.PI / 8, 2 * Math.acos(Math.max(-1, 1 - chordTolerance / radius)));
    const sampleCount = Math.max(2, Math.ceil(Math.abs(sweep) / angleStep));

    for (let index = 1; index <= sampleCount; index += 1) {
      const interpolation = index / sampleCount;
      const angle = startAngle + sweep * interpolation;
      output.push({
        type: record.type,
        x: index === sampleCount ? record.x : centerX + radius * Math.cos(angle),
        y: index === sampleCount ? record.y : centerY + radius * Math.sin(angle),
        z: record.z,
        comment: index === sampleCount ? record.comment : null,
        feedType: "feed_rate",
        feedrate: record.feedrate,
        motionRole: record.motionRole,
      });
    }
  }

  return output;
}

function pushUniqueSample(
  samples: SimulationSamplePoint[],
  record: LinearPositionRecord3D,
  distanceFromStart: number,
) {
  const previousSample = samples.at(-1);
  if (previousSample && arePositionsEqual(previousSample, record) && previousSample.feedType === record.feedType) {
    return;
  }

  samples.push({ ...record, distanceFromStart, sampleIndex: samples.length });
}

export function sampleOperationRecords(
  sourceRecords: ReadonlyArray<PositionRecord3D>,
  spacing: number,
  rapidSpacingScale = 1,
): SimulationSamplePoint[] {
  const records = linearizeOperationRecords(sourceRecords);
  if (records.length === 0) {
    return [];
  }

  const shouldSampleSegments = Number.isFinite(spacing) && spacing > 0;
  const samples: SimulationSamplePoint[] = [];
  let traversedDistance = 0;
  pushUniqueSample(samples, records[0], traversedDistance);

  for (let index = 1; index < records.length; index += 1) {
    const start = records[index - 1];
    const end = records[index];
    const segmentLength = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);

    if (segmentLength <= POSITION_EPSILON) {
      continue;
    }

    const segmentSpacing = end.feedType === "rapid" ? spacing * rapidSpacingScale : spacing;
    if (shouldSampleSegments && Number.isFinite(segmentSpacing) && segmentSpacing > 0) {
      for (let segmentDistance = segmentSpacing; segmentDistance < segmentLength - POSITION_EPSILON; segmentDistance += segmentSpacing) {
        const interpolation = segmentDistance / segmentLength;
        pushUniqueSample(
          samples,
          {
            ...end,
            x: start.x + (end.x - start.x) * interpolation,
            y: start.y + (end.y - start.y) * interpolation,
            z: start.z + (end.z - start.z) * interpolation,
          },
          traversedDistance + segmentDistance,
        );
      }
    }

    traversedDistance += segmentLength;
    pushUniqueSample(samples, end, traversedDistance);
  }

  return samples.map((sample, sampleIndex) => ({ ...sample, sampleIndex }));
}
