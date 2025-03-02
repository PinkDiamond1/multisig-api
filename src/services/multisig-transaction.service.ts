import { ResponseDto } from '../dtos/responses/response.dto';
import { MODULE_REQUEST } from '../module.config';

export interface IMultisigTransactionService {
  /**
   * Create multisig transaction
   * @param request
   */
  createMultisigTransaction(
    request: MODULE_REQUEST.CreateTransactionRequest,
  ): Promise<ResponseDto>;

  /**
   * Confirm multisig transaction
   * @param request
   */
  confirmMultisigTransaction(
    request: MODULE_REQUEST.ConfirmTransactionRequest,
  ): Promise<ResponseDto>;

  /**
   * Send multisig transaction
   * @param request
   */
  sendMultisigTransaction(
    request: MODULE_REQUEST.SendTransactionRequest,
  ): Promise<ResponseDto>;

  /**
   * Reject multisig transaction
   * @param request
   */
  rejectMultisigTransaction(
    request: MODULE_REQUEST.RejectTransactionParam,
  ): Promise<ResponseDto>;
}
