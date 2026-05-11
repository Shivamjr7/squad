// Type-only module. No runtime side effects, no `db` import — safe for
// client components to import without pulling the server-side query helpers
// into the client bundle (which causes "Cannot read properties of undefined
// (reading 'call')" in webpack dev when a side-effect module gets traced
// across the use-client boundary).

export type UserCircle = {
  id: string;
  name: string;
  slug: string;
  role: "admin" | "member";
  memberCount: number;
};

export type KnownSquadUser = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
};
