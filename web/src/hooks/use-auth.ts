"use client";

import { useCallback, useEffect, useState } from "react";
import { currentSession, signOut as cognitoSignOut, type AuthSession } from "@/lib/auth/cognito";

export type AuthState =
  | { status: "loading" }
  | { status: "out" }
  | { status: "in"; email: string; idToken: string };

export function useAuth() {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  const refresh = useCallback(() => {
    void currentSession().then((s: AuthSession | null) =>
      setState(s ? { status: "in", email: s.email, idToken: s.idToken } : { status: "out" }),
    );
  }, []);

  useEffect(() => {
    // Async resolution keeps this out of the render/effect-sync path.
    const t = window.setTimeout(refresh, 0);
    return () => window.clearTimeout(t);
  }, [refresh]);

  const signOut = useCallback(() => {
    cognitoSignOut();
    setState({ status: "out" });
  }, []);

  return { state, refresh, signOut };
}
