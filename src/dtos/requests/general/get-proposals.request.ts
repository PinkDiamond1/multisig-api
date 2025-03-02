import { QueryProposalsRequest } from 'cosmjs-types/cosmos/gov/v1beta1/query';
import { ProposalStatus } from 'cosmjs-types/cosmos/gov/v1beta1/gov';
import { PageRequest } from 'cosmjs-types/cosmos/base/query/v1beta1/pagination';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GetProposalsQuery implements QueryProposalsRequest {
  @ApiProperty({
    description: 'Internal Id of Chain',
    type: Number,
  })
  internalChainId: number;

  @ApiPropertyOptional({
    description: 'proposalStatus defines the status of the proposals.',
    enum: ProposalStatus,
  })
  proposalStatus: ProposalStatus;

  @ApiPropertyOptional({
    description: 'Voter address for the proposals',
    type: String,
  })
  voter: string;

  @ApiPropertyOptional({
    description: 'depositor addresses from the proposals',
    type: String,
  })
  depositor: string;

  @ApiPropertyOptional({
    description: 'pagination',
    type: PageRequest,
  })
  pagination: PageRequest;
}
