import { Inject, Injectable, Logger } from '@nestjs/common';
import { ResponseDto } from 'src/dtos/responses/response.dto';
import { ErrorMap } from '../../common/error.map';
import {
  MODULE_REQUEST,
  REPOSITORY_INTERFACE,
  RESPONSE_CONFIG,
} from 'src/module.config';
import { CommonUtil } from 'src/utils/common.util';
import { IGovService } from '../igov.service';
import { IGeneralRepository } from 'src/repositories';
import { Chain } from 'src/entities';
import { ConfigService } from 'src/shared/services/config.service';
import { ProposalDepositResponse } from 'src/dtos/responses';
import { PROPOSAL_STATUS } from 'src/common/constants/app.constant';
import {
  GetProposalsProposal,
  GetProposalsResponse,
  GetProposalsTally,
} from 'src/dtos/responses/gov/get-proposals.response';

@Injectable()
export class GovService implements IGovService {
  private readonly _logger = new Logger(GovService.name);
  private _commonUtil: CommonUtil = new CommonUtil();
  auraChain: Chain;
  indexerUrl: string;

  constructor(
    private configService: ConfigService,
    @Inject(REPOSITORY_INTERFACE.IGENERAL_REPOSITORY)
    private chainRepo: IGeneralRepository,
  ) {
    this._logger.log(
      '============== Constructor Multisig Wallet Service ==============',
    );
    this.indexerUrl = this.configService.get('INDEXER_URL');
  }

  async getProposals(param: MODULE_REQUEST.GetProposalsParam) {
    const { internalChainId } = param;
    try {
      const chain = await this.chainRepo.findChain(internalChainId);
      const response = await this._commonUtil.request(
        new URL(
          `api/v1/proposals?chainid=${chain.chainId}&pageLimit=7&pageOffset=0`,
          this.indexerUrl,
        ).href,
      );
      const proposals = response.data.proposals;
      const results: GetProposalsResponse = {
        proposals: [],
      };
      for (const proposal of proposals) {
        const result: GetProposalsProposal = {
          id: proposal.proposal_id,
          title: proposal.content.title,
          status: proposal.status,
          votingStart: proposal.voting_start_time,
          votingEnd: proposal.voting_end_time,
          submitTime: proposal.submit_time,
          totalDeposit: proposal.total_deposit,
          tally: this.getProposalTally(proposal),
        };
        results.proposals.push(result);
      }
      return ResponseDto.response(ErrorMap.SUCCESSFUL, results);
    } catch (e) {
      return ResponseDto.responseError(GovService.name, e);
    }
  }

  getProposalTally(proposal: any) {
    if (proposal.status === PROPOSAL_STATUS.VOTING_PERIOD) {
      const tally = proposal.tally;
      //default mostVoted to yes
      let mostVotedOptionKey = tally.yes;
      // calculate sum to determine percentage
      let sum = 0;
      for (const key in tally) {
        if (+tally[key] > +tally[mostVotedOptionKey]) {
          mostVotedOptionKey = key;
        }
        sum += +tally[key];
      }

      const result: GetProposalsTally = {
        yes: {
          number: tally.yes,
          percent: (+tally.yes * 100) / sum,
        },
        abstain: {
          number: tally.abstain,
          percent: (+tally.abstain * 100) / sum,
        },
        no: {
          number: tally.no,
          percent: (+tally.no * 100) / sum,
        },
        noWithVeto: {
          number: tally.no_with_veto,
          percent: (+tally.no_with_veto * 100) / sum,
        },
        mostVotedOn: {
          name: mostVotedOptionKey,
          percent: (+tally[mostVotedOptionKey] * 100) / sum,
        },
      };
      return result;
    }
  }

  async getProposalDetails(param: MODULE_REQUEST.GetProposalDetailsParam) {
    const { internalChainId, proposalId } = param;
    const chain = await this.chainRepo.findChain(internalChainId);
    const result = await this._commonUtil.request(
      new URL(`api/v1/proposal`, this.indexerUrl).href,
    );
    const networkBond = await this._commonUtil.request(
      new URL(
        `api/v1/network/status?chainid=${chain.chainId}`,
        this.configService.get('INDEXER'),
      ).href,
    );

    return ResponseDto.response(ErrorMap.SUCCESSFUL, result.data);
  }

  async getProposalValidatorVotesById(
    param: MODULE_REQUEST.GetProposalValidatorVotesByIdPathParams,
  ): Promise<ResponseDto> {
    const { internalChainId, proposalId } = param;
    try {
      // const chain = await this.chainRepo.findChain(internalChainId);

      // Get list validators

      // For each validator, get vote tx

      // Get bonded tokens
      // const getNetworkStatusURL = new URL(
      //   `/api/v1/network/status?chainid=${chain.chainId}`,
      //   this.configService.get('INDEXER_URL'),
      // ).href;
      // const networkStatus = await this._commonUtil.request(getNetworkStatusURL);
      // const bondedTokens = networkStatus.data?.pool?.bonded_tokens || -1;

      // // Get proposal
      // const getProposalDetailURL = new URL(
      //   `api/v1/proposal?chainid=${chain.chainId}&proposalId=${proposalId}`,
      //   this.configService.get('INDEXER_URL'),
      // ).href;
      return ResponseDto.response(ErrorMap.SUCCESSFUL, {});
    } catch (e) {
      return ResponseDto.responseError(GovService.name, e);
    }
  }

  async getProposalDepositById(
    param: MODULE_REQUEST.GetProposalDepositsByIdPathParams,
  ): Promise<ResponseDto> {
    const { internalChainId, proposalId } = param;
    try {
      const chain = await this.chainRepo.findChain(internalChainId);

      // Get proposal deposit txs
      const getProposalDepositsURL = new URL(
        `api/v1/transaction?chainid=${chain.chainId}&searchType=proposal_deposit&searchKey=proposal_id&searchValue=${proposalId}&pageOffset=0&pageLimit=10&countTotal=false&reverse=false`,
        this.indexerUrl,
      ).href;
      const depositTxs = await this._commonUtil.request(getProposalDepositsURL);
      const response: ProposalDepositResponse[] = [];

      for (const tx of depositTxs.data.transactions) {
        // const deposit = tx.tx.value.msg[0].value;
        const proposalDepositEvent = tx.tx_response.logs[0].events.find(
          (x) => x.type === 'proposal_deposit',
        );
        const proposalDepositResponse: ProposalDepositResponse = {
          proposal_id: Number(
            proposalDepositEvent?.attributes.find(
              (x) => x.key === 'proposal_id',
            )?.value,
          ),
          depositor: tx.tx_response.tx.body.messages[0].proposer,
          tx_hash: tx.tx_response.txhash,
          amount: Number(
            tx.tx_response.tx.body.messages[0].initial_deposit[0]?.amount ||
              tx.tx_response.tx.body.messages[0].amount[0]?.amount ||
              0,
          ),
          timestamp: tx.tx_response.timestamp,
        };
        response.push(proposalDepositResponse);
      }
      return ResponseDto.response(ErrorMap.SUCCESSFUL, response);
    } catch (e) {
      return ResponseDto.responseError(GovService.name, e);
    }
  }
}
