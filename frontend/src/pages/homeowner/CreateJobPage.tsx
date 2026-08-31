import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError } from "../../api/client";
import { createJob } from "../../api/jobs";
import { Shell } from "../../components/Shell";

const CATEGORIES = [
  "plumbing",
  "electrical",
  "carpentry",
  "painting",
  "appliance",
  "other",
];

export function CreateJobPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const formEl = e.currentTarget;
    const fd = new FormData(formEl);
    const photos = formEl.querySelector<HTMLInputElement>('input[name="photos"]');
    if (photos?.files) {
      fd.delete("photos");
      Array.from(photos.files).forEach((f) => fd.append("photos", f));
    }

    try {
      const res = await createJob(fd);
      navigate(`/homeowner/jobs/${res.job.id}`, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create job");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Shell title="Post a job">
      <p>
        <Link to="/homeowner">← Back to my jobs</Link>
      </p>
      {error && <div className="alert">{error}</div>}
      <form className="form-grid" onSubmit={onSubmit}>
        <label>
          Title
          <input name="title" required />
        </label>
        <label>
          Description
          <textarea name="description" rows={4} required />
        </label>
        <label>
          Category
          <select name="category" required defaultValue="plumbing">
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <div className="row-2">
          <label>
            Area
            <input name="area" />
          </label>
          <label>
            Pincode
            <input name="pincode" />
          </label>
        </div>
        <div className="row-2">
          <label>
            Budget min
            <input name="budgetMin" type="number" min="0" step="1" />
          </label>
          <label>
            Budget max
            <input name="budgetMax" type="number" min="0" step="1" />
          </label>
        </div>
        <label>
          Max bids
          <input name="maxBids" type="number" min="1" defaultValue={5} />
        </label>
        <label>
          Preferred start
          <input name="preferredStart" type="datetime-local" />
        </label>
        <label>
          Photos
          <input name="photos" type="file" accept="image/*,application/pdf" multiple />
        </label>
        <button className="btn primary" type="submit" disabled={submitting}>
          {submitting ? "Posting…" : "Create job"}
        </button>
      </form>
    </Shell>
  );
}
