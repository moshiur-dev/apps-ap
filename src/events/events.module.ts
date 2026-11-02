import { Global, Module } from '@nestjs/common';
import { EventsService } from './events.service';
import { MailService } from './mail.service';
import { NotificationsController } from './notifications.controller';

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [EventsService, MailService],
  exports: [EventsService, MailService],
})
export class EventsModule {}
