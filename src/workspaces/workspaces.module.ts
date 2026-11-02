import { Global, Module } from '@nestjs/common';
import { AccessService } from './access.service';
import { InvitesController } from './invites.controller';
import { WorkspacesController } from './workspaces.controller';

@Global()
@Module({
  controllers: [WorkspacesController, InvitesController],
  providers: [AccessService],
  exports: [AccessService],
})
export class WorkspacesModule {}
