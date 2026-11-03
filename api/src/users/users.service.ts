import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PgErrorCode, pgErrorCode } from '../database/pg-error-codes';
import { User, UserRole } from './entities/user.entity';

@Injectable()
export class UsersService {
  constructor(@InjectRepository(User) private readonly users: Repository<User>) {}

  async createCustomer(email: string, passwordHash: string): Promise<User> {
    try {
      return await this.users.save(
        this.users.create({ email, passwordHash, role: UserRole.Customer }),
      );
    } catch (error) {
      // Relying on the unique constraint (rather than a pre-check) is race-free.
      if (pgErrorCode(error) === PgErrorCode.UniqueViolation) {
        throw new ConflictException('Email is already registered');
      }
      throw error;
    }
  }

  findById(id: string): Promise<User | null> {
    return this.users.findOneBy({ id });
  }

  findByEmailWithPasswordHash(email: string): Promise<User | null> {
    return this.users
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email })
      .getOne();
  }
}
