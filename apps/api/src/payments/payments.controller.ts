import { Body, Controller, Headers, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { JwtPayload } from '../auth/jwt.strategy';
import { CreateOrderDto } from './dto/create-order.dto';
import { CreatedOrder, PaymentsService, RazorpayWebhookBody } from './payments.service';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('orders')
  @UseGuards(JwtAuthGuard)
  createOrder(@CurrentUser() user: JwtPayload, @Body() dto: CreateOrderDto): Promise<CreatedOrder> {
    return this.payments.createOrder(user.sub, dto);
  }

  /**
   * No auth guard — this is Razorpay calling us, not one of our users.
   * Authenticity comes entirely from the signature check inside
   * `handleWebhook`, verified against `req.rawBody` (see main.ts's
   * `rawBody: true`), never from anything in `req.body`.
   */
  @Post('webhook/razorpay')
  @HttpCode(200)
  handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-razorpay-signature') signature: string,
    @Body() body: RazorpayWebhookBody,
  ): Promise<{ received: boolean }> {
    return this.payments.handleWebhook(req.rawBody, signature, body);
  }
}
