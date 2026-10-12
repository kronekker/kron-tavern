import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  HttpException,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { DatabaseService } from '../database/database.service.js';
import { AdminGuard } from '../auth/admin.guard.js';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly dbService: DatabaseService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Retrieve SQLite database metrics, file size, versions, and row counts' })
  getDatabaseStats() {
    return this.dbService.getStats();
  }

  @Get('tables')
  @ApiOperation({ summary: 'List all registered database tables with row counts' })
  getTables() {
    return this.dbService.getTables();
  }

  @Get('tables/:tableName')
  @ApiOperation({ summary: 'Browse paginated records and column definitions for a given table' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'pageSize', required: false, type: Number, example: 20 })
  getTableData(
    @Param('tableName') tableName: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    try {
      const pageNum = Math.max(1, parseInt(page, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20));
      return this.dbService.getTableData(tableName, pageNum, limitNum);
    } catch (err: any) {
      throw new HttpException(err.message, HttpStatus.BAD_REQUEST);
    }
  }

  @Delete('tables/:tableName/:id')
  @ApiOperation({ summary: 'Delete a specific record from a database table by ID' })
  deleteRecord(
    @Param('tableName') tableName: string,
    @Param('id') id: string,
  ) {
    try {
      const deleted = this.dbService.deleteTableRow(tableName, id);
      if (!deleted) {
        throw new HttpException('Record not found or already deleted', HttpStatus.NOT_FOUND);
      }
      return { success: true, message: `Record ${id} deleted from ${tableName}.` };
    } catch (err: any) {
      throw new HttpException(err.message, HttpStatus.BAD_REQUEST);
    }
  }

  @Post('maintenance/vacuum')
  @ApiOperation({ summary: 'Perform database VACUUM to reclaim free space and defragment' })
  runVacuum() {
    this.dbService.runVacuum();
    return { success: true, message: 'Database VACUUM completed successfully.' };
  }

  @Get('maintenance/integrity-check')
  @ApiOperation({ summary: 'Run SQLite integrity check to verify database health' })
  runIntegrityCheck() {
    const result = this.dbService.runIntegrityCheck();
    return { success: true, result };
  }

  @Post('seed-demo')
  @ApiOperation({ summary: 'Seed initial demo user, persona, character, and lorebook memories' })
  seedDemo() {
    return this.dbService.seedDemoData();
  }
}
