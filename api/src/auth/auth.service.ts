import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { UsersService } from '../users/users.service';
import { JwtPayload } from './auth-user';
import { AccessTokenDto } from './dto/access-token.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

export const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
  // Compared against when the email is unknown, so both failure paths take the same time.
  private readonly dummyHash = bcrypt.hashSync('dummy-password-for-timing', BCRYPT_ROUNDS);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto): Promise<UserResponseDto> {
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const user = await this.usersService.createCustomer(dto.email, passwordHash);
    return UserResponseDto.fromEntity(user);
  }

  async login(dto: LoginDto): Promise<AccessTokenDto> {
    const user = await this.usersService.findByEmailWithPasswordHash(dto.email);
    const passwordMatches = await bcrypt.compare(
      dto.password,
      user?.passwordHash ?? this.dummyHash,
    );
    if (!user || !passwordMatches) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const payload: JwtPayload = { sub: user.id, role: user.role };
    return { accessToken: await this.jwtService.signAsync(payload) };
  }

  async getProfile(userId: string): Promise<UserResponseDto> {
    const user = await this.usersService.findById(userId);
    // A valid token for a user that no longer exists is treated as unauthenticated.
    if (!user) {
      throw new UnauthorizedException();
    }
    return UserResponseDto.fromEntity(user);
  }
}
