export interface SequenceInterpolation {
  indexA: number;
  indexB: number;
  localProgress: number;
}

export function resolveSequenceInterpolation(progress: number, itemCount: number): SequenceInterpolation {
  if (itemCount <= 1) {
    return { indexA: 0, indexB: 0, localProgress: 0 };
  }

  const clampedProgress = Math.max(0, Math.min(progress, 1));
  const totalSegments = itemCount - 1;
  const scaledProgress = clampedProgress * totalSegments;

  if (clampedProgress >= 1) {
    return {
      indexA: totalSegments,
      indexB: totalSegments,
      localProgress: 1,
    };
  }

  const indexA = Math.floor(scaledProgress);
  const indexB = Math.min(indexA + 1, totalSegments);

  return {
    indexA,
    indexB,
    localProgress: scaledProgress - indexA,
  };
}
