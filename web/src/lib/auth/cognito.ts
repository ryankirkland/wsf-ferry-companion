// Thin promise wrapper over amazon-cognito-identity-js (SRP: passwords
// never transit our code or servers - the SDK does the SRP dance straight
// with Cognito). Sessions live in localStorage under the SDK's own keys.

import {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserAttribute,
  CognitoUserPool,
  type CognitoUserSession,
} from "amazon-cognito-identity-js";
import { COGNITO_CLIENT_ID, COGNITO_POOL_ID } from "@/config";

const pool = () => new CognitoUserPool({ UserPoolId: COGNITO_POOL_ID, ClientId: COGNITO_CLIENT_ID });

const user = (email: string) => new CognitoUser({ Username: email.trim().toLowerCase(), Pool: pool() });

export interface AuthSession {
  email: string;
  idToken: string;
}

export function currentSession(): Promise<AuthSession | null> {
  return new Promise((resolve) => {
    const current = pool().getCurrentUser();
    if (!current) return resolve(null);
    current.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session || !session.isValid()) return resolve(null);
      const payload = session.getIdToken().decodePayload() as { email?: string };
      resolve({ email: payload.email ?? current.getUsername(), idToken: session.getIdToken().getJwtToken() });
    });
  });
}

export function signUp(email: string, password: string): Promise<void> {
  return new Promise((resolve, reject) => {
    pool().signUp(
      email.trim().toLowerCase(),
      password,
      [new CognitoUserAttribute({ Name: "email", Value: email.trim().toLowerCase() })],
      [],
      (err) => (err ? reject(err) : resolve()),
    );
  });
}

export function confirmSignUp(email: string, code: string): Promise<void> {
  return new Promise((resolve, reject) => {
    user(email).confirmRegistration(code.trim(), true, (err) => (err ? reject(err) : resolve()));
  });
}

export function resendCode(email: string): Promise<void> {
  return new Promise((resolve, reject) => {
    user(email).resendConfirmationCode((err) => (err ? reject(err) : resolve()));
  });
}

export function signIn(email: string, password: string): Promise<AuthSession> {
  return new Promise((resolve, reject) => {
    const u = user(email);
    u.authenticateUser(new AuthenticationDetails({ Username: email.trim().toLowerCase(), Password: password }), {
      onSuccess: (session) => {
        const payload = session.getIdToken().decodePayload() as { email?: string };
        resolve({ email: payload.email ?? u.getUsername(), idToken: session.getIdToken().getJwtToken() });
      },
      onFailure: reject,
    });
  });
}

export function signOut(): void {
  pool().getCurrentUser()?.signOut();
}

/** Change the signed-in user's password (SRP session required; the SDK
 *  talks straight to Cognito - passwords never transit our code). */
export function changePassword(currentPw: string, newPw: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const current = pool().getCurrentUser();
    if (!current) return reject(new Error("Not signed in"));
    current.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session || !session.isValid()) {
        return reject(err ?? new Error("Session expired - sign in again"));
      }
      current.changePassword(currentPw, newPw, (e) => (e ? reject(e) : resolve()));
    });
  });
}

export function forgotPassword(email: string): Promise<void> {
  return new Promise((resolve, reject) => {
    user(email).forgotPassword({ onSuccess: () => resolve(), onFailure: reject, inputVerificationCode: () => resolve() });
  });
}

export function confirmForgotPassword(email: string, code: string, password: string): Promise<void> {
  return new Promise((resolve, reject) => {
    user(email).confirmPassword(code.trim(), password, { onSuccess: () => resolve(), onFailure: reject });
  });
}
