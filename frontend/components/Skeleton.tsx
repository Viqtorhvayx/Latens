export function Skeleton({ width = 60, height = 14 }: { width?: number | string; height?: number }) {
  return <span className="inline-block animate-pulse rounded bg-line-strong align-middle" style={{ width, height }} />;
}
