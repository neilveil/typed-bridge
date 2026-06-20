// Named context shapes injected by middleware (see ../middleware.ts).
// Handlers annotate their second parameter with one of these so the data a
// handler depends on is obvious at a glance.

export type guest = { requestedAt: number }

export type user = { requestedAt: number; userId: number }

export type admin = { requestedAt: number; userId: number; isAdmin: boolean }
