import type {
  FeedRatePositionRecord3D as GeneratedFeedRatePositionRecord3D,
  OperationRecord3D as GeneratedOperationRecord3D,
  RapidPositionRecord3D as GeneratedRapidPositionRecord3D,
} from "@/generated_schemas/cl_data";

export type FeedType = "rapid" | "feed_rate";

export type PositionRecord3D =
  | (GeneratedRapidPositionRecord3D & { feedType: "rapid" })
  | (GeneratedFeedRatePositionRecord3D & { feedType: "feed_rate" });

export type OperationRecord3D = Omit<GeneratedOperationRecord3D, "records"> & {
  records: PositionRecord3D[];
};

export type SimulationSamplePoint = PositionRecord3D & {
  sampleIndex: number;
  distanceFromStart: number;
};

const POSITION_EPSILON = 1e-6;

function arePositionsEqual(left: PositionRecord3D, right: PositionRecord3D) {
  return (
    Math.abs(left.x - right.x) <= POSITION_EPSILON &&
    Math.abs(left.y - right.y) <= POSITION_EPSILON &&
    Math.abs(left.z - right.z) <= POSITION_EPSILON
  );
}

function pushUniqueSample(
  samples: SimulationSamplePoint[],
  record: PositionRecord3D,
  distanceFromStart: number,
) {
  const previousSample = samples.at(-1);
  if (previousSample && arePositionsEqual(previousSample, record) && previousSample.feedType === record.feedType) {
    return;
  }

  samples.push({ ...record, distanceFromStart, sampleIndex: samples.length });
}

export function sampleOperationRecords(
  records: ReadonlyArray<PositionRecord3D>,
  spacing: number,
  rapidSpacingScale = 1,
): SimulationSamplePoint[] {
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
