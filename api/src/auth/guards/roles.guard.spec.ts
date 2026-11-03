import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../../users/entities/user.entity';
import { RolesGuard } from './roles.guard';

function contextFor(user: unknown): ExecutionContext {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  const reflector = new Reflector();
  const guard = new RolesGuard(reflector);

  afterEach(() => jest.restoreAllMocks());

  it('allows any authenticated user when no roles are required', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    expect(guard.canActivate(contextFor({ userId: 'u1', role: UserRole.Customer }))).toBe(true);
  });

  it('allows a user with a required role', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([UserRole.Admin]);
    expect(guard.canActivate(contextFor({ userId: 'u1', role: UserRole.Admin }))).toBe(true);
  });

  it('forbids a user without a required role', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([UserRole.Admin]);
    expect(() => guard.canActivate(contextFor({ userId: 'u1', role: UserRole.Customer }))).toThrow(
      ForbiddenException,
    );
  });
});
