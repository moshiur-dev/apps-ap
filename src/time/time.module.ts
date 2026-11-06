import { Module } from '@nestjs/common';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { TimeController } from './time.controller';

@Module({
  imports: [WorkspacesModule],
  controllers: [TimeController],
})
export class TimeModule {}
