export interface ApiResponse<T = any> {
  success: boolean;
  message: string;
  statusCode?: number;
  data: T;
}

export const successResponse = <T>(
  data: T,
  message: string = 'Success',
  statusCode?: number
): ApiResponse<T> => ({
  success: true,
  message,
  ...(statusCode && { statusCode }),
  data,
});

export const errorResponse = (
  message: string = 'Error',
  data: any = null,
  statusCode?: number
): ApiResponse<any> => ({
  success: false,
  message,
  ...(statusCode && { statusCode }),
  data,
});
