// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "./Table";

describe("Table", () => {
  it("renders as a real table with real header/data cells", () => {
    render(
      <Table>
        <TableHead>
          <TableRow>
            <TableHeaderCell>الخطة</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          <TableRow>
            <TableCell>شريك مؤسِّس</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "الخطة" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("cell", { name: "شريك مؤسِّس" }),
    ).toBeInTheDocument();
  });
});
