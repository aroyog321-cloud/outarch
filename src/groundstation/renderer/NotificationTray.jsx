import React from "react";
import * as Popover from "@radix-ui/react-popover";
import { ToastIcon, useNotificationHistory } from "./ToastSystem.jsx";

/* The notification list.

   It sits in two places: the status tape, and — because focus mode hides the
   tape — the floating focus deck.

   Why it exists, in focus mode.

   Focus mode hides the sidebar and the status tape, and with them the Needs
   You count and every other place a notification could be found again. A toast
   that arrived while the operator was reading a terminal was gone for good once
   it was dismissed. This is the one control that brings them back: a bell on
   the focus deck, counting what is new, opening the recent notifications with
   the same actions their toasts carried — Open, Copy URL, Restart, Stop, Who's
   using it. */

function clock(at) {
  const minutes = Math.floor((Date.now() - at) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function NotificationTray({ needsCount = 0, onReviewNeeds, variant = "deck" }) {
  const history = useNotificationHistory();
  const [open, setOpen] = React.useState(false);
  // The tape already shows the Needs You count beside the bell, so there the
  // badge counts only new notifications; the deck has nothing else to show it.
  const badge = history.unread + (variant !== "tape" && needsCount > 0 ? needsCount : 0);

  return <Popover.Root open={open} onOpenChange={value => { setOpen(value); if (!value) history.markAllRead(); }}>
    <Popover.Trigger asChild>
      <button
        type="button"
        className={`${variant === "tape" ? "status-bar-premium__bell" : "workspace-notifications"} ${badge ? "has-unread" : ""}`}
        aria-label={badge ? `Notifications, ${badge} new` : "Notifications"}
        title="Notifications"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 9.5a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16s-2-1.5-2-6.5Z"/><path d="M13.7 19.5a2 2 0 0 1-3.4 0"/></svg>
        {badge > 0 && <b aria-hidden="true">{badge > 99 ? "99+" : badge}</b>}
      </button>
    </Popover.Trigger>
    <Popover.Portal>
      <Popover.Content className="notification-tray" side={variant === "tape" ? "bottom" : "top"} align="end" sideOffset={8} collisionPadding={12} aria-label="Notifications">
        <header className="notification-tray__head">
          <strong>Notifications</strong>
          {history.items.length > 0 && <button type="button" onClick={history.clear}>Clear all</button>}
        </header>
        {needsCount > 0 && <button type="button" className="notification-tray__needs" onClick={() => { setOpen(false); onReviewNeeds?.(); }}>
          <span><strong>{needsCount}</strong> {needsCount === 1 ? "item needs" : "items need"} your decision</span>
          <em>Review</em>
        </button>}
        {history.items.length === 0
          ? <p className="notification-tray__empty">Nothing yet. A service coming up, a port conflict or a failed worker shows up here.</p>
          : <ol className="notification-tray__list">
              {history.items.map(item => <li key={item.id} className={`notification-tray__item is-${item.type} ${item.read ? "" : "is-unread"}`}>
                <span className="notification-tray__icon"><ToastIcon type={item.type}/></span>
                <div className="notification-tray__copy">
                  <p>{item.title || item.message}</p>
                  {item.title && item.message && <small>{item.message}</small>}
                  {item.detail && <small>{item.detail}</small>}
                  {item.source && <span className="notification-tray__source">{item.source}</span>}
                  <time dateTime={new Date(item.createdAt).toISOString()}>{clock(item.createdAt)}</time>
                  {item.actions.length > 0 && <div className="notification-tray__actions">
                    {item.actions.map((action, index) => <button
                      key={action.label}
                      type="button"
                      className={index === 0 ? "is-primary" : action.tone === "danger" ? "is-danger" : ""}
                      onClick={() => { action.run(); if (action.keepOpen !== true) setOpen(false); }}
                    >{action.label}</button>)}
                  </div>}
                </div>
                <button type="button" className="notification-tray__forget" aria-label="Remove this notification" onClick={() => history.forget(item.id)}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
                </button>
              </li>)}
            </ol>}
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>;
}
