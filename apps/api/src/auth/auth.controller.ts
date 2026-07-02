import { Body, Controller, Post } from '@nestjs/common';
import { AuthResult, AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { SignupDto } from './dto/signup.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('signup')
  signup(@Body() dto: SignupDto): Promise<AuthResult> {
    return this.auth.signup(dto);
  }

  @Post('login')
  login(@Body() dto: LoginDto): Promise<AuthResult> {
    return this.auth.login(dto);
  }
}
