import { IsEmail, IsEnum, IsOptional, MinLength } from 'class-validator';
import { UserRole } from '../../entities/user-role.enum';

export class SignupDto {
  @IsEmail()
  email!: string;

  @MinLength(8)
  password!: string;

  /** Defaults to customer in AuthService; owner is the only other choice in this app's minimal RBAC surface. */
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}
