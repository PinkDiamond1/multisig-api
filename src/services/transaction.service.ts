import { ResponseDto } from "src/dtos/responses/response.dto";
import { MODULE_REQUEST } from "src/module.config";

export interface ITransactionService {

    /**
     * create transaction
     * @param request 
     */
    createTransaction(request: MODULE_REQUEST.CreateTransactionRequest): Promise<ResponseDto>;

    /**
     * send transaction
     * @param request
     */
    sendTransaction(request: MODULE_REQUEST.SendTransactionRequest): Promise<ResponseDto>;

    /**
     * single sign to a transaction
     * @param request
     */
    singleSignTransaction(request: MODULE_REQUEST.SingleSignTransactionRequest): Promise<ResponseDto>;

    /**
    * broadcast transaction
    * @param request
    */
    broadcastTransaction(request: MODULE_REQUEST.BroadcastTransactionRequest): Promise<ResponseDto>;
}