import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useServerField } from "./useServerField";

function Card({ server }: { server: { name: string; phone: string } }) {
  const [name, setName] = useServerField(server.name);
  const [phone, setPhone] = useServerField(server.phone);
  return (
    <div>
      <input aria-label="name" value={name} onChange={(e) => setName(e.target.value)} />
      <input aria-label="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
    </div>
  );
}

describe("useServerField (fe-logic HIGH 7)", () => {
  it("keeps an unsaved edit when another card's save updates the user, and follows untouched fields", async () => {
    const { rerender } = render(<Card server={{ name: "Priya", phone: "111" }} />);
    await userEvent.clear(screen.getByLabelText("name"));
    await userEvent.type(screen.getByLabelText("name"), "Priya S");
    // Another card saved: the server copy of the user changes.
    rerender(<Card server={{ name: "Priya", phone: "222" }} />);
    expect(screen.getByLabelText("name")).toHaveValue("Priya S");
    expect(screen.getByLabelText("phone")).toHaveValue("222");
  });
});
