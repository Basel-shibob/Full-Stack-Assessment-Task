import {IsMongoId, IsOptional, ValidateIf} from 'class-validator';

export class UpdateTaskAssigneeDto {
    @ValidateIf((_, value) => value !== null)
    @IsMongoId()
    @IsOptional()
    assigneeId?: string | null;
} 