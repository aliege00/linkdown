import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useQuery } from "convex/react";

// True when the app was built with a real Convex deployment URL. On the
// packaged APK/EXE this is false, so auth is disabled and the app runs fully
// on-device with no backend. This is a build-time constant — the early return
// below never changes hook order at runtime.
const HAS_CONVEX = !!import.meta.env.VITE_CONVEX_URL;

type SignInFn = ReturnType<typeof useAuthActions>["signIn"];
type SignOutFn = ReturnType<typeof useAuthActions>["signOut"];

export type AuthState = {
  isLoading: boolean;
  isAuthenticated: boolean;
  user: Doc<"users"> | null | undefined;
  signIn: SignInFn;
  signOut: SignOutFn;
};

/**
 * Guest state used when the app is built without VITE_CONVEX_URL (offline APK
 * mode). In that mode the Convex auth providers are not mounted, so the hooks
 * below would throw "must be used within ConvexAuthProvider". HAS_CONVEX is a
 * build-time constant, so this branch is identical on every render — the early
 * return never changes the hook order at runtime.
 */
const GUEST_AUTH: AuthState = {
  isLoading: false,
  isAuthenticated: false,
  user: null,
  signIn: (async () => ({ signingIn: false })) as unknown as SignInFn,
  signOut: (async () => {}) as unknown as SignOutFn,
};

export function useAuth(): AuthState {
  if (!HAS_CONVEX) {
    return GUEST_AUTH;
  }

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { isLoading: isAuthLoading, isAuthenticated } = useConvexAuth();
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const user = useQuery(api.users.currentUser);
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { signIn, signOut } = useAuthActions();

  // Derive isLoading directly from the dependencies instead of managing separate state
  const isLoading = isAuthLoading || user === undefined;

  return {
    isLoading,
    isAuthenticated,
    user,
    signIn,
    signOut,
  };
}
