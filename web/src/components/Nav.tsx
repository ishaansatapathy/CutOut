"use client";
/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAccountUi, useMe } from "./studio/account";
import { Logo } from "./Logo";

const LINKS = [
  { href: "/#tools", label: "Tools" },
  { href: "/#how", label: "How it works" },
  { href: "/#video", label: "Video" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/#developers", label: "Developers" },
];

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  const close = () => setOpen(false);

  return (
    <header className={`nav ${scrolled ? "scrolled" : ""} ${open ? "open" : ""}`}>
      <span className="progress" aria-hidden />
      <div className="nav-inner">
        <Link href="/" aria-label="CutOut home" onClick={close}><Logo size={32} /></Link>
        <nav className="nav-links" aria-label="Main">
          {LINKS.map((l) => <Link key={l.href} href={l.href}>{l.label}</Link>)}
        </nav>
        <div className="nav-end">
          <NavAccount />
          <button className="nav-menu" aria-label="Menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            <span /><span />
          </button>
        </div>
      </div>
      <nav className="nav-drawer" aria-label="Mobile">
        {LINKS.map((l) => <Link key={l.href} href={l.href} onClick={close}>{l.label}</Link>)}
      </nav>
    </header>
  );
}

function NavAccount() {
  const me = useMe();
  const ui = useAccountUi();
  const user = me.data?.user;

  if (user) {
    return (
      <>
        <Link href="/app" className="btn btn-k btn-sm" id="nav-open">Open studio <span className="arrow">→</span></Link>
        <Link href="/account" className="nav-av" aria-label="Account" title={`${me.data?.usage.credits ?? 0} credits`}>
          {user.picture ? <img src={user.picture} alt="" /> : <span>{(user.name ?? user.email)[0].toUpperCase()}</span>}
        </Link>
      </>
    );
  }
  return (
    <>
      <button className="nav-signin" onClick={() => ui.signIn()} id="nav-signin">Sign in</button>
      <Link href="/app" className="btn btn-k btn-sm" id="nav-try">Try it free <span className="arrow">→</span></Link>
    </>
  );
}
