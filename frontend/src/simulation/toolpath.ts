export type ToolpathKind = "cut" | "clearance";

export type ToolData = {
  diameter: number;
  cuttingHeight: number;
  maxDepthOfCut: number;
  numFlutes: number;
};

export type ToolpathLocation = {
  x: number;
  y: number;
  z: number;
  comment?: string | null;
};

export type Toolpath = {
  id: string;
  name: string | null;
  kind: ToolpathKind;
  locations: ToolpathLocation[];
};

export type ToolpathOperation = {
  tool: ToolData;
  paths: Toolpath[];
};

export type SimulationSamplePoint = ToolpathLocation & {
  sampleIndex: number;
  pathId: string;
  pathName: string | null;
  pathKind: ToolpathKind;
  distanceFromStart: number;
};

const POSITION_EPSILON = 1e-6;

function areLocationsEqual(left: ToolpathLocation, right: ToolpathLocation) {
  return (
    Math.abs(left.x - right.x) <= POSITION_EPSILON &&
    Math.abs(left.y - right.y) <= POSITION_EPSILON &&
    Math.abs(left.z - right.z) <= POSITION_EPSILON
  );
}

function createSamplePoint(
  location: ToolpathLocation,
  path: Toolpath,
  distanceFromStart: number,
  sampleIndex: number,
): SimulationSamplePoint {
  return {
    x: location.x,
    y: location.y,
    z: location.z,
    comment: location.comment,
    sampleIndex,
    pathId: path.id,
    pathName: path.name,
    pathKind: path.kind,
    distanceFromStart,
  };
}

function pushUniqueSample(
  samples: SimulationSamplePoint[],
  location: ToolpathLocation,
  path: Toolpath,
  distanceFromStart: number,
) {
  const previousSample = samples.at(-1);

  if (
    previousSample &&
    areLocationsEqual(previousSample, location) &&
    previousSample.pathId === path.id &&
    previousSample.pathKind === path.kind
  ) {
    return;
  }

  samples.push(createSamplePoint(location, path, distanceFromStart, samples.length));
}

export function sampleToolpathLocations(
  paths: ReadonlyArray<Toolpath>,
  spacing: number,
): SimulationSamplePoint[] {
  if (paths.length === 0) {
    return [];
  }

  const shouldSampleSegments = Number.isFinite(spacing) && spacing > 0;
  const samples: SimulationSamplePoint[] = [];
  let traversedDistance = 0;

  for (const path of paths) {
    if (path.locations.length === 0) {
      continue;
    }

    pushUniqueSample(samples, path.locations[0], path, traversedDistance);

    for (let index = 1; index < path.locations.length; index += 1) {
      const start = path.locations[index - 1];
      const end = path.locations[index];
      const segmentLength = Math.hypot(
        end.x - start.x,
        end.y - start.y,
        end.z - start.z,
      );

      if (segmentLength <= POSITION_EPSILON) {
        continue;
      }

      if (shouldSampleSegments) {
        for (
          let segmentDistance = spacing;
          segmentDistance < segmentLength - POSITION_EPSILON;
          segmentDistance += spacing
        ) {
          const interpolation = segmentDistance / segmentLength;
          pushUniqueSample(
            samples,
            {
              x: start.x + (end.x - start.x) * interpolation,
              y: start.y + (end.y - start.y) * interpolation,
              z: start.z + (end.z - start.z) * interpolation,
              comment: end.comment,
            },
            path,
            traversedDistance + segmentDistance,
          );
        }
      }

      traversedDistance += segmentLength;
      pushUniqueSample(samples, end, path, traversedDistance);
    }
  }

  return samples.map((sample, sampleIndex) => ({
    ...sample,
    sampleIndex,
  }));
}
