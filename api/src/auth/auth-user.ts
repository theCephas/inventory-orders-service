import { UserRole } from '../users/entities/user.entity';

export interface JwtPayload {
  sub: string;
  role: UserRole;
}

/** The authenticated principal attached to `request.user` by the JWT strategy. */
export interface AuthUser {
  userId: string;
  role: UserRole;
}
