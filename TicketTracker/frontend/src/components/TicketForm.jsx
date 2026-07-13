import { useState } from "react";

const CATEGORIES = ["Admin", "Curriculum", "Infrastructure", "HR", "DLP"];
const MAX_IMAGES = 3;

export default function TicketForm({ onSubmit, submitting, submitError }) {
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [description, setDescription] = useState("");
  const [imageLinks, setImageLinks] = useState([""]);

  const updateLink = (idx, value) => {
    setImageLinks((prev) => prev.map((l, i) => (i === idx ? value : l)));
  };

  const addLinkField = () => {
    if (imageLinks.length < MAX_IMAGES) setImageLinks((prev) => [...prev, ""]);
  };

  const removeLinkField = (idx) => {
    setImageLinks((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit({ category, description, imageLinks: imageLinks.map((l) => l.trim()).filter(Boolean) });
  };

  return (
    <form className="card ticket-form" onSubmit={handleSubmit}>
      <h2 className="card-heading">Log a New Ticket</h2>

      <label className="field-label">Category</label>
      <select className="field-input" value={category} onChange={(e) => setCategory(e.target.value)}>
        {CATEGORIES.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>

      <label className="field-label">Describe the problem</label>
      <textarea
        className="field-input"
        rows={5}
        placeholder="What went wrong? Include as much detail as helps whoever picks this up."
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />

      <label className="field-label">Photos (optional, up to {MAX_IMAGES})</label>
      <div className="help-text">
        Upload your photo to Google Drive, set sharing to "Anyone with the link", then paste the link here.
      </div>

      {imageLinks.map((link, idx) => (
        <div className="link-input-row" key={idx}>
          <input
            type="url"
            className="field-input"
            placeholder="https://drive.google.com/file/d/..."
            value={link}
            onChange={(e) => updateLink(idx, e.target.value)}
          />
          {imageLinks.length > 1 && (
            <button type="button" className="link-remove" onClick={() => removeLinkField(idx)}>×</button>
          )}
        </div>
      ))}

      {imageLinks.length < MAX_IMAGES && (
        <button type="button" className="btn btn-ghost btn-add-link" onClick={addLinkField}>
          + Add another link
        </button>
      )}

      {submitError && <div className="form-error">{submitError}</div>}

      <button className="btn btn-primary btn-block" type="submit" disabled={submitting}>
        {submitting ? "Submitting…" : "Submit Ticket"}
      </button>
    </form>
  );
}
