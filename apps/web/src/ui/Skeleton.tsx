import { cn } from "./cn";

export interface SkeletonProps extends React.ComponentPropsWithRef<"div"> {
  width?: string | number;
  height?: string | number;
}

export function Skeleton({
  className,
  width,
  height,
  style,
  ...props
}: SkeletonProps) {
  return (
    <div
      role="status"
      className={cn("ui-skeleton", className)}
      style={{ width, height, ...style }}
      {...props}
    />
  );
}
