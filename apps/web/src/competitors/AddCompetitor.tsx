import { useState } from "react";
import { useStrings } from "../strings";
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
      <label>
        {S.compAdd}
        <input value={value} onChange={(e) => setValue(e.target.value)} />
      </label>
      <small>{S.addDirectAvailableDesc}</small>
      <button disabled={!value.trim()}>{S.addChannelSearch}</button>
    </form>
  );
}
