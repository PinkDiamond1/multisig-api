import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { VALIDATOR_STATUS } from '../../../common/constants/app.constant';

export class GetValidatorsParam {
  @ApiProperty({
    description: 'Internal Id of Chain',
    type: Number,
  })
  @IsString()
  internalChainId: number;
}

export class GetValidatorsQuery {
  @ApiPropertyOptional({
    description: 'Status of validators',
    type: VALIDATOR_STATUS,
  })
  status: VALIDATOR_STATUS;
}
