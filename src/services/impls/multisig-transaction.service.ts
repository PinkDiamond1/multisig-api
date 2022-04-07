import { Inject, Injectable, Logger } from '@nestjs/common';
import { ResponseDto } from 'src/dtos/responses/response.dto';
import { ErrorMap } from '../../common/error.map';
import { MODULE_REQUEST, REPOSITORY_INTERFACE } from '../../module.config';
import { IMultisigTransactionService } from '../multisig-transaction.service';
import {
  calculateFee,
  coins,
  GasPrice,
  makeMultisignedTx,
  StargateClient,
} from '@cosmjs/stargate';
import { fromBase64 } from '@cosmjs/encoding';
import { TxRaw } from 'cosmjs-types/cosmos/tx/v1beta1/tx';
import { BaseService } from './base.service';
import { Chain, MultisigTransaction } from 'src/entities';
import {
  MULTISIG_CONFIRM_STATUS,
  NETWORK_URL_TYPE,
  TRANSACTION_STATUS,
} from 'src/common/constants/app.constant';
import { CustomError } from 'src/common/customError';
import {
  IGeneralRepository,
  IMultisigConfirmRepository,
  IMultisigTransactionsRepository,
  IMultisigWalletOwnerRepository,
  IMultisigWalletRepository,
} from 'src/repositories';
import { ConfirmTransactionRequest } from 'src/dtos/requests';
import { ISmartContractRepository } from 'src/repositories/ismart-contract.repository';
import { Coins, Fee, LCDClient, LegacyAminoMultisigPublicKey, MnemonicKey, MsgSend, MultiSignature, SignatureV2, SignDoc, SimplePublicKey } from '@terra-money/terra.js';
import { CommonUtil } from 'src/utils/common.util';

@Injectable()
export class MultisigTransactionService
  extends BaseService
  implements IMultisigTransactionService {
  private readonly _logger = new Logger(MultisigTransactionService.name);
  private _commonUtil: CommonUtil = new CommonUtil();

  constructor(
    @Inject(REPOSITORY_INTERFACE.IMULTISIG_TRANSACTION_REPOSITORY)
    private multisigTransactionRepos: IMultisigTransactionsRepository,
    @Inject(REPOSITORY_INTERFACE.IMULTISIG_CONFIRM_REPOSITORY)
    private multisigConfirmRepos: IMultisigConfirmRepository,
    @Inject(REPOSITORY_INTERFACE.IGENERAL_REPOSITORY)
    private chainRepos: IGeneralRepository,
    @Inject(REPOSITORY_INTERFACE.IMULTISIG_WALLET_REPOSITORY)
    private safeRepos: IMultisigWalletRepository,
    @Inject(REPOSITORY_INTERFACE.IMULTISIG_WALLET_OWNER_REPOSITORY)
    private safeOwnerRepo: IMultisigWalletOwnerRepository,
    @Inject(REPOSITORY_INTERFACE.ISMART_CONTRACT_REPOSITORY)
    private smartContractRepos: ISmartContractRepository,
  ) {
    super(multisigTransactionRepos);
    this._logger.log(
      '============== Constructor Multisig Transaction Service ==============',
    );
  }

  async createTransaction(
    request: MODULE_REQUEST.CreateTransactionRequest,
  ): Promise<ResponseDto> {
    const res = new ResponseDto();
    try {
      //Validate safe
      let signResult = await this.signingInstruction(request.internalChainId, request.from, request.amount);

      //Validate transaction creator
      await this.multisigConfirmRepos.validateOwner(request.creatorAddress, request.from, request.internalChainId);

      //Validate safe don't have tx pending
      await this.multisigTransactionRepos.validateCreateTx(request.from);
      await this.smartContractRepos.validateCreateTx(request.from);

      let safe = await this.safeRepos.findOne({ where: { safeAddress: request.from } });

      //Safe data into DB
      let transactionResult =
        await this.multisigTransactionRepos.insertMultisigTransaction(request.from, request.to, request.amount, request.gasLimit, request.fee, signResult.accountNumber,
          NETWORK_URL_TYPE.COSMOS, signResult.denom, TRANSACTION_STATUS.AWAITING_CONFIRMATIONS, request.internalChainId, signResult.sequence.toString(), safe.id);

      let requestSign = new ConfirmTransactionRequest();
      requestSign.fromAddress = request.creatorAddress;
      requestSign.transactionId = transactionResult.id;
      requestSign.bodyBytes = request.bodyBytes;
      requestSign.signature = request.signature;
      requestSign.internalChainId = request.internalChainId;

      //Sign to transaction
      await this.confirmTransaction(requestSign);

      return res.return(ErrorMap.SUCCESSFUL, transactionResult.id, { 'transactionId:': transactionResult.id });
    } catch (error) {
      return ResponseDto.responseError(MultisigTransactionService.name, error);
    }
  }

  async sendTransaction(
    request: MODULE_REQUEST.SendTransactionRequest,
  ): Promise<ResponseDto> {
    const res = new ResponseDto();
    try {
      let chain = await this.chainRepos.findOne({ where: { id: request.internalChainId } });

      let client;
      if (chain.name !== 'Terra Testnet') client = await StargateClient.connect(chain.rpc);
      else
        client = new LCDClient({
          chainID: chain.chainId,
          URL: chain.rest,
        });

      //get information multisig transaction Id
      let multisigTransaction = await this.multisigTransactionRepos.validateTxBroadcast(request.transactionId);

      //Validate owner
      await this.multisigConfirmRepos.validateOwner(request.owner, multisigTransaction.fromAddress, request.internalChainId);

      //Make tx
      let txBroadcast = await this.makeTx(request.transactionId, multisigTransaction, chain, client);

      try {
        //Record owner send transaction
        await this.multisigConfirmRepos.insertIntoMultisigConfirm(request.transactionId, request.owner, '', '', request.internalChainId, MULTISIG_CONFIRM_STATUS.SEND);

        if(chain.name !== 'Terra Testnet') await client.broadcastTx(txBroadcast, 1000, 100);
        else {
          const result = await client.tx.broadcast(txBroadcast);
          console.log(result)
          if(result.code === 0) {
            multisigTransaction.status = TRANSACTION_STATUS.SUCCESS;
            multisigTransaction.txHash = result.txhash;
            await this.multisigTransactionRepos.update(multisigTransaction);
            return res.return(ErrorMap.SUCCESSFUL, { 'TxHash': result.txhash });
          } else {
            multisigTransaction.status = TRANSACTION_STATUS.FAILED;
            multisigTransaction.txHash = result.txhash;
            await this.multisigTransactionRepos.update(multisigTransaction);
            return res.return(ErrorMap.BROADCAST_TX_FAILED, { 'Log': result.raw_log });
          }
        }
      } catch (error) {
        console.log('Error', error);
        //Update status and txhash
        //TxHash is encoded transaction when send it to network
        if (typeof error.txId === 'undefined') {
          multisigTransaction.status = TRANSACTION_STATUS.FAILED;
          await this.multisigTransactionRepos.update(multisigTransaction);
          return ResponseDto.responseError(MultisigTransactionService.name, error);
        } else {
          await this.multisigTransactionRepos.updateTxBroadcastSucces(multisigTransaction.id, error.txId);
          return res.return(ErrorMap.SUCCESSFUL, { 'TxHash': error.txId });
        }
      }
    } catch (error) {
      return ResponseDto.responseError(MultisigTransactionService.name, error);
    }
  }

  async confirmTransaction(
    request: MODULE_REQUEST.ConfirmTransactionRequest,
  ): Promise<ResponseDto> {
    const res = new ResponseDto();
    try {
      let transaction = await this.multisigTransactionRepos.checkExistMultisigTransaction(request.transactionId, request.internalChainId);

      await this.multisigConfirmRepos.validateOwner(request.fromAddress, transaction.fromAddress, request.internalChainId);

      //User has confirmed transaction before
      await this.multisigConfirmRepos.checkUserHasSigned(request.transactionId, request.fromAddress);

      await this.multisigConfirmRepos.insertIntoMultisigConfirm(
        request.transactionId,
        request.fromAddress,
        request.signature,
        request.bodyBytes,
        request.internalChainId,
        MULTISIG_CONFIRM_STATUS.CONFIRM,
      );

      await this.multisigTransactionRepos.validateTransaction(request.transactionId, request.internalChainId);

      return res.return(ErrorMap.SUCCESSFUL);
    } catch (error) {
      return ResponseDto.responseError(MultisigTransactionService.name, error);
    }
  }

  async rejectTransaction(
    request: MODULE_REQUEST.RejectTransactionParam,
  ): Promise<ResponseDto> {
    const res = new ResponseDto();
    try {
      //Check status of multisig transaction when reject transaction
      let transaction =
        await this.multisigTransactionRepos.checkExistMultisigTransaction(request.transactionId, request.internalChainId);

      //Validate owner
      await this.multisigConfirmRepos.validateOwner(request.fromAddress, transaction.fromAddress, request.internalChainId);

      //Check user has rejected transaction before
      await this.multisigConfirmRepos.checkUserHasSigned(request.transactionId, request.fromAddress);

      await this.multisigConfirmRepos.insertIntoMultisigConfirm(
        request.transactionId,
        request.fromAddress,
        '',
        '',
        request.internalChainId,
        MULTISIG_CONFIRM_STATUS.REJECT,
      );

      let rejectConfirms = await this.multisigConfirmRepos.findByCondition({
        multisigTransactionId: request.transactionId,
        status: MULTISIG_CONFIRM_STATUS.REJECT,
      });

      let safeOwner = await this.safeOwnerRepo.findByCondition({
        safeId: transaction.safeId
      });

      let safe = await this.safeRepos.findOne({
        where: { id: transaction.safeId },
      });

      if (safeOwner.length - rejectConfirms.length < safe.threshold) {
        transaction.status = TRANSACTION_STATUS.CANCELLED;
        await this.multisigTransactionRepos.update(transaction);
      }

      return res.return(ErrorMap.SUCCESSFUL);
    } catch (error) {
      return ResponseDto.responseError(MultisigTransactionService.name, error);
    }
  }

  async signingInstruction(internalChainId: number, sendAddress: string, amount: number): Promise<any> {

    const chain = await this.chainRepos.findChain(internalChainId);

    let balance, accountOnChain;
    if (chain.name !== 'Terra Testnet') {
      const client = await StargateClient.connect(chain.rpc);

      balance = await client.getBalance(sendAddress, chain.denom);

      //Check account
      accountOnChain = await client.getAccount(sendAddress);
      if (!accountOnChain) {
        throw new CustomError(ErrorMap.E001);
      }

      if (Number(balance.amount) < amount) {
        throw new CustomError(ErrorMap.BALANCE_NOT_ENOUGH);
      }
    } else {
      const bombay = new LCDClient({
        chainID: chain.chainId,
        URL: chain.rest,
      });

      balance = await (await bombay.bank.balance(sendAddress))[0].toString().match(/\d+/g)[0];

      //Check account
      accountOnChain = await bombay.auth.accountInfo(sendAddress);
      if (!accountOnChain) {
        throw new CustomError(ErrorMap.E001);
      }

      if (Number(balance) < amount) {
        throw new CustomError(ErrorMap.BALANCE_NOT_ENOUGH);
      }
    }

    return {
      accountNumber: (chain.name !== 'Terra Testnet') ? accountOnChain.accountNumber : accountOnChain.getAccountNumber(),
      sequence: (chain.name !== 'Terra Testnet') ? accountOnChain.sequence : accountOnChain.getSequenceNumber(),
      chainId: chain.chainId,
      denom: chain.denom,
    };
  }

  async makeTx(
    transactionId: number,
    multisigTransaction: MultisigTransaction,
    chain: Chain,
    client: StargateClient | LCDClient
  ): Promise<any> {
    //Get safe info
    let safeInfo = await this.safeRepos.findOne({
      where: { id: multisigTransaction.safeId },
    });

    if (chain.name !== 'Terra Testnet') {
      //Get all signature of transaction
      let multisigConfirmArr = await this.multisigConfirmRepos.findByCondition({
        multisigTransactionId: transactionId,
        status: MULTISIG_CONFIRM_STATUS.CONFIRM,
      });

      let addressSignarureMap = new Map<string, Uint8Array>();

      multisigConfirmArr.forEach((x) => {
        let encodeSignature = fromBase64(x.signature);
        addressSignarureMap.set(x.ownerAddress, encodeSignature);
      });

      //Fee
      const sendFee = {
        amount: coins(multisigTransaction.fee, multisigTransaction.denom),
        gas: multisigTransaction.gas.toString(),
      };

      let encodedBodyBytes = fromBase64(multisigConfirmArr[0].bodyBytes);

      //Pubkey
      const safePubkey = JSON.parse(safeInfo.safePubkey);

      let executeTransaction = makeMultisignedTx(
        safePubkey,
        Number(multisigTransaction.sequence),
        sendFee,
        encodedBodyBytes,
        addressSignarureMap,
      );

      let encodeTransaction = Uint8Array.from(TxRaw.encode(executeTransaction).finish());
      return encodeTransaction;
    } else {

      let multisigConfirmArr = await this.multisigConfirmRepos.getListConfirmWithPubkey(multisigTransaction.id, MULTISIG_CONFIRM_STATUS.CONFIRM, safeInfo.id);

      const tx = await this._commonUtil.makeTerraTx(multisigTransaction, safeInfo, multisigConfirmArr, client as LCDClient);

      return tx;
    }
  }
}

