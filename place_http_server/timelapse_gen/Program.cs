﻿using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;

namespace TimelapseGen;

public static class Program
{
    public static void Main(string[] args)
    {
        Generate("VID", "", "", 30, 10, 10, 30, 30, 2000, 2000);
    }
    
    public static async void Generate(string outName, string backupStart, string backupEnd, uint fps, int sX, int sY, int eX, int eY, int sizeX, int sizeY)
    {
        var parentDir = Directory.GetParent(Directory.GetCurrentDirectory())?.FullName;
        var backups = await File.ReadAllLinesAsync(Path.Join(parentDir, "backuplist.txt"));
        foreach (var backup in backups)
        {
            var board = await File.ReadAllBytesAsync(Path.Join(parentDir, backup));
            using var image = new Image<Rgba32>(eX - sX, eY - sY);
            var i = eX * sY + sX;
            while (i < board.Length)
            {
                image[i % eX - sX, i / eY - sY] = Colours[board[i]];
                i++;
                if (i % eX <= eX) continue;
                if (i / eX == eY) break;
                i += sX - eX + sX;
            }
            await image.SaveAsPngAsync(Path.Join(parentDir, outName));
        }
    }

    private static readonly Rgba32[] Colours =
    {
        new(109, 0, 26),
        new(190, 0, 57),
        new(255, 69, 0),
        new(255, 168, 0),
        new(255, 214, 53),
        new(255, 248, 184),
        new(0, 163, 104),
        new(0, 204, 120),
        new(126, 237, 86),
        new(0, 117, 111),
        new(0, 158, 170),
        new(0, 204, 192),
        new(36, 80, 164),
        new(54, 144, 234),
        new(81, 233, 244),
        new(73, 58, 193),
        new(106, 92, 255),
        new(148, 179, 255),
        new(129, 30, 159),
        new(180, 74, 192),
        new(228, 171, 255),
        new(222, 16, 127),
        new(255, 56, 129),
        new(255, 153, 170),
        new(109, 72, 47),
        new(156, 105, 38),
        new(255, 180, 112),
        new(0, 0, 0),
        new(81, 82, 82),
        new(137, 141, 144),
        new(212, 215, 217),
        new(255, 255, 255)
    };
}