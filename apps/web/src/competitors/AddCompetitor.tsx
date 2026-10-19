import { useState } from "react";
import { useStrings } from "../strings";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
export function AddCompetitor({ onAdd }: { onAdd: (input: string) => void }) {
  const S = useStrings();
  const [value, setValue] = useState("");
  return (
    <form
      className="competitor-add"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) onAdd(value.trim());
      }}
    >
      <label htmlFor="competitor-input">{S.compAdd}</label>
      <Input
        id="competitor-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <small>{S.addDirectAvailableDesc}</small>
      <Button type="submit" disabled={!value.trim()}>
        {S.addChannelSearch}
      </Button>
    </form>
  );
}
