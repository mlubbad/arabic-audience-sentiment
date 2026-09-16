import { cn } from "./cn";

export function Table({
  className,
  ...props
}: React.ComponentPropsWithRef<"table">) {
  return <table className={cn("ui-table", className)} {...props} />;
}
export const TableHead = (props: React.ComponentPropsWithRef<"thead">) => (
  <thead {...props} />
);
export const TableBody = (props: React.ComponentPropsWithRef<"tbody">) => (
  <tbody {...props} />
);
export const TableRow = (props: React.ComponentPropsWithRef<"tr">) => (
  <tr {...props} />
);
export const TableHeaderCell = (props: React.ComponentPropsWithRef<"th">) => (
  <th scope="col" {...props} />
);
export const TableCell = (props: React.ComponentPropsWithRef<"td">) => (
  <td {...props} />
);
