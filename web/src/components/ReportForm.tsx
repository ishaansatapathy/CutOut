"use client";

import { useState } from "react";
import { api } from "@/trpc/client";

export function ReportForm() {
  const submit = api.report.submit.useMutation();
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");

  if (submit.isSuccess) {
    return (
      <div className="report-done" role="status">
        <b>Thanks — we&apos;ve got your report.</b>
        <p>If you left an email, we&apos;ll reply there.</p>
      </div>
    );
  }

  return (
    <form
      className="report-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit.mutate({ message, email: email || undefined, url: typeof window !== "undefined" ? document.referrer : undefined });
      }}
    >
      <label className="opt-label" htmlFor="r-msg">What happened?</label>
      <textarea id="r-msg" className="text-in" rows={6} required minLength={5} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Describe the content or the request, with a link if you have one." />
      <label className="opt-label" htmlFor="r-email">Your email (optional, so we can reply)</label>
      <input id="r-email" className="text-in" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
      <button className="btn btn-k" disabled={submit.isPending} id="report-submit">{submit.isPending ? "Sending…" : "Send report"}</button>
      {submit.error && <p className="form-err">Couldn&apos;t send. Please try again.</p>}
    </form>
  );
}
